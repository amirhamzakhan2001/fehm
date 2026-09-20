import { codeReviewGuidance } from "./upstream-adaptations.js";
import { captureIndexedSource, reviewSourceFreshness } from "./review-freshness.js";
import { execFile } from "node:child_process";
import path from "node:path";
import { stat, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolveReviewEngine } from "./review-engine.js";
import { readIndex } from "./indexer.js";
import { buildContextPacket, formatContextPacket } from "./context.js";
import { linkReviewFindings } from "./review-findings.js";

export function reviewPlan(argv: string[]) {
  let mode = "review", repository = process.cwd(), timeoutMs = 300_000;
  let from: string | undefined, to: string | undefined, commit: string | undefined, scanPath: string | undefined;
  let execute = false, graphReport = false;
  let contextQuery: string | undefined;
  let profile: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (seen.has(flag)) throw new Error(`Duplicate review option: ${flag}`);
    seen.add(flag);
    if (flag === "--allow-provider") { execute = true; continue; }
    if (flag === "--graph-report") { graphReport = true; continue; }
    if (flag === "--scan") { mode = "scan"; continue; }
    if (!["--repo", "--from", "--to", "--commit", "--path", "--timeout", "--context", "--profile"].includes(flag)) throw new Error(`Unknown review option: ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith("-") || value.includes("\0")) throw new Error(`Expected a value for ${flag}`);
    if (flag === "--profile") {
      if (value !== "code-review") throw new Error("Supported review profile: code-review");
      profile = value;
    }
    if (flag === "--context") contextQuery = value;
    if (flag === "--repo") repository = path.resolve(value);
    if (flag === "--from") from = value;
    if (flag === "--to") to = value;
    if (flag === "--commit") commit = value;
    if (flag === "--path") scanPath = value;
    if (flag === "--timeout") {
      timeoutMs = Number(value);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1_800_000) throw new Error("Review timeout must be 1000–1800000 milliseconds");
    }
  }
  if (!!from !== !!to) throw new Error("Use --from and --to together");
  if (commit && from) throw new Error("Choose a commit or a branch range");
  if (mode === "scan" && (from || commit)) throw new Error("Scan cannot use Git diff selectors");
  if ((contextQuery || profile) && mode === "scan") throw new Error("Fehm context handoff currently supports diff reviews only; omit --context for full-file scans.");
  if (scanPath?.includes(",")) throw new Error("Choose one scan path per Fehm review invocation");
  if (scanPath && mode !== "scan") throw new Error("--path requires --scan");
  if (scanPath) {
    const relative = path.relative(repository, path.resolve(repository, scanPath));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Scan path must be inside the repository");
  }
  const args = [mode];
  if (from && to) args.push("--from", from, "--to", to);
  if (commit) args.push("--commit", commit);
  if (scanPath) args.push("--path", scanPath);
  args.push("--format", "json");
  return { tool: "Open Code Review", executable: "ocr", repository, args, timeoutMs, execute, graphReport, contextQuery, profile,
    notice: "Open Code Review may send source and context to its configured model and invoke configured tools. Review its configuration first. Findings are external model output, not verified Fehm graph facts." };
}

export async function runOpenCodeReview(plan: ReturnType<typeof reviewPlan>): Promise<string> {
  if (!plan.execute) return JSON.stringify(plan, null, 2);
  if (!(await stat(plan.repository)).isDirectory()) throw new Error("Review repository must be a directory");
  const engine = plan.executable === 'ocr' ? await resolveReviewEngine() : { executable: plan.executable };
  const args = [...plan.args];
  const graph = plan.graphReport || plan.contextQuery ? await readIndex(path.join(plan.repository, '.fehm/graph.json')) : undefined;
  if (graph && path.resolve(graph.repository.root) !== path.resolve(plan.repository)) throw new Error('Graph belongs to a different repository; rescan before reviewing.');
  const before = plan.graphReport && graph ? await captureIndexedSource(graph) : undefined;
  let temporary: string | undefined;
  try {
    if (plan.contextQuery || plan.profile) {
      const packet = plan.contextQuery && graph ? await buildContextPacket(graph, plan.contextQuery, { budgetTokens: 4000 }) : undefined;
      temporary = await mkdtemp(path.join(tmpdir(), 'fehm-review-context-'));
      const background = path.join(temporary, 'context.md');
      await writeFile(background, [plan.profile ? codeReviewGuidance : "", packet ? formatContextPacket(packet) : ""].filter(Boolean).join("\n\n"), { mode: 0o600 });
      args.push('--background-file', background);
    }
    const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(engine.executable, args, {
      cwd: plan.repository, timeout: plan.timeoutMs, maxBuffer: 8 * 1024 * 1024,
      killSignal: "SIGKILL", encoding: "utf8",
    }, (error, stdout) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        reject(new Error(code === "ENOENT"
          ? "Open Code Review is not installed or not on PATH. See docs/OPEN_CODE_REVIEW.md."
          : "Open Code Review failed, timed out, or exceeded the output limit. Check Open Code Review configuration with its CLI; provider charges may already have occurred."));
      } else resolve(stdout);
    });
    child.stdin?.end();
    });
    if (plan.graphReport && graph && before) {
      const report = linkReviewFindings(output, graph);
      return JSON.stringify({ ...report, sourceFreshness: reviewSourceFreshness(before, await captureIndexedSource(graph)) }, null, 2);
    }
    return output;
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
