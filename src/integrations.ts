import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const integrationPlatforms = {
  claude: { user: ".claude/skills", project: ".claude/skills", label: "Claude Code" },
  cursor: { user: ".cursor/skills", project: ".cursor/skills", label: "Cursor" },
  codex: { user: ".agents/skills", project: ".agents/skills", label: "Codex" },
  gemini: { user: ".gemini/skills", project: ".gemini/skills", label: "Gemini CLI" },
  copilot: { user: ".copilot/skills", project: ".github/skills", label: "GitHub Copilot CLI" },
  vscode: { user: ".copilot/skills", project: ".github/skills", label: "VS Code Copilot" },
  generic: { user: ".agents/skills", project: ".agents/skills", label: "Agent Skills compatible clients" },
} as const;

type Platform = keyof typeof integrationPlatforms;
const marker = /\n<!-- fehm-managed sha256:([a-f0-9]{64}) -->\n$/;
const digest = (body: string): string => createHash("sha256").update(body).digest("hex");

export interface IntegrationOptions {
  platform: string;
  project?: boolean;
  dryRun?: boolean;
  force?: boolean;
  cwd?: string;
  home?: string;
}

async function optionalRead(file: string): Promise<string | undefined> {
  try { return await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

// Refuse symlinked destinations so installation cannot silently escape its scope.
async function checkDestination(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing symlinked integration path: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export async function manageIntegration(action: "install" | "uninstall" | "status", options: IntegrationOptions) {
  if (!(options.platform in integrationPlatforms) || !Object.hasOwn(integrationPlatforms, options.platform)) {
    throw new Error(`Unknown platform ${options.platform}. Choose: ${Object.keys(integrationPlatforms).join(", ")}`);
  }
  const platform = options.platform as Platform;
  const scope = options.project ? "project" : "user";
  const root = path.resolve(options.project ? (options.cwd ?? process.cwd()) : (options.home ?? homedir()));
  const target = path.join(root, integrationPlatforms[platform][scope], "fehm", "SKILL.md");
  await checkDestination(root, target);
  const template = await readFile(new URL("../integrations/fehm/SKILL.md", import.meta.url), "utf8");
  const content = `${template}\n<!-- fehm-managed sha256:${digest(template)} -->\n`;
  const existing = await optionalRead(target);
  const match = existing?.match(marker);
  const unmodified = !!match && digest(existing!.slice(0, match.index)) === match[1];
  const state = existing === undefined ? "missing" : existing === content ? "current" : unmodified ? "outdated" : "customized";
  const result = { platform, label: integrationPlatforms[platform].label, scope, path: target, state, action, dryRun: !!options.dryRun };
  if (action === "status") return result;
  if (existing !== undefined && !unmodified && !options.force) {
    throw new Error(`Preserving customized skill at ${target}. Move it aside, or use --force to back it up and ${action}.`);
  }
  if (options.dryRun || (action === "install" && state === "current") || (action === "uninstall" && state === "missing")) return result;
  await mkdir(path.dirname(target), { recursive: true });
  if (existing !== undefined && !unmodified) {
    await writeFile(`${target}.${Date.now()}.${process.pid}.bak`, existing, { flag: "wx" });
  }
  if (action === "uninstall") await unlink(target);
  else {
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, content, { flag: "wx" });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
  }
  return { ...result, state: action === "install" ? "current" : "missing" };
}
