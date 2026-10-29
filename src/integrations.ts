import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
interface InstallSource {
  get(id:string): {license:string;sourceRepository?:string} | undefined;
  source(id:string): string;
  resourceFiles(id:string): {path:string;content:Buffer}[];
}

/**
 * Installation mode: copy selected skills into an agent platform's skills
 * directory. Routing never installs anything; this runs only on request.
 *
 * Restored from Fehm's earlier integration layer (git 15a4f01,
 * src/integrations.ts): the platform table, symlink refusal, the managed
 * marker that distinguishes Fehm-written files from customized ones, backup
 * with --force, and temp-file + rename writes. Generalized from the single
 * built-in Fehm skill to any registry skill.
 */
export const integrationPlatforms = {
  claude: { user: ".claude/skills", project: ".claude/skills", label: "Claude Code" },
  cursor: { user: ".cursor/skills", project: ".cursor/skills", label: "Cursor" },
  codex: { user: ".agents/skills", project: ".agents/skills", label: "Codex" },
  gemini: { user: ".gemini/skills", project: ".gemini/skills", label: "Gemini CLI" },
  copilot: { user: ".copilot/skills", project: ".github/skills", label: "GitHub Copilot CLI" },
  vscode: { user: ".copilot/skills", project: ".github/skills", label: "VS Code Copilot" },
  generic: { user: ".agents/skills", project: ".agents/skills", label: "Agent Skills compatible clients" },
} as const;

export type Platform = keyof typeof integrationPlatforms;
const marker = /\n<!-- fehm-managed sha256:([a-f0-9]{64}) -->\n$/;
const digest = (body: string | Buffer): string => createHash("sha256").update(body).digest("hex");

export interface InstallOptions {
  platform: string;
  project?: boolean;
  dryRun?: boolean;
  force?: boolean;
  /** Allow installing skills whose license is unknown (redistribution risk). */
  allowUnknownLicense?: boolean;
  cwd?: string;
  home?: string;
}

export interface InstallResult {
  skillId: string;
  platform: Platform;
  label: string;
  scope: "user" | "project";
  path: string;
  state: "missing" | "current" | "outdated" | "customized";
  action: "install" | "uninstall" | "status";
  dryRun: boolean;
}

async function optionalRead(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
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

/** Directory name for an installed skill: `fehm-` + id with separators flattened. */
export function installedSkillName(skillId: string): string {
  if (skillId === "fehm") return "fehm";
  return `fehm-${skillId.replace(/[/:]+/g, "-").replace(/[^A-Za-z0-9._-]/g, "")}`;
}

export async function manageSkill(registry: InstallSource, skillId: string, action: "install" | "uninstall" | "status", options: InstallOptions): Promise<InstallResult> {
  if (!Object.hasOwn(integrationPlatforms, options.platform)) {
    throw new Error(`Unknown platform ${options.platform}. Choose: ${Object.keys(integrationPlatforms).join(", ")}`);
  }
  const record = registry.get(skillId);
  if (!record) throw new Error(`unknown skill ${skillId}`);
  if (action === "install" && record.license === "unknown" && !options.allowUnknownLicense) {
    throw new Error(`Refusing to install ${skillId}: license unknown. Check ${record.sourceRepository} and pass --allow-unknown-license to proceed.`);
  }
  const platform = options.platform as Platform;
  const scope = options.project ? "project" : "user";
  const root = path.resolve(options.project ? (options.cwd ?? process.cwd()) : (options.home ?? homedir()));
  const target = path.join(root, integrationPlatforms[platform][scope], installedSkillName(skillId), "SKILL.md");
  await checkDestination(root, target);
  const template = registry.source(skillId);
  const resources = registry.resourceFiles(skillId);
  const content = `${template}\n<!-- fehm-managed sha256:${digest(template)} -->\n`;
  const directory = path.dirname(target);
  const inventoryPath = path.join(directory, ".fehm-resources.json");
  await checkDestination(root, inventoryPath);
  const oldInventory = await optionalRead(inventoryPath);
  let previous: Record<string, string> = {};
  if (oldInventory !== undefined) {
    try {
      const parsed: unknown = JSON.parse(oldInventory);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected object");
      previous = parsed as Record<string, string>;
      if (Object.keys(previous).length > 64 || Object.entries(previous).some(([name, hash]) =>
        !safeResourceName(name) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) throw new Error("invalid paths/hashes");
    } catch {
      throw new Error(`Preserving invalid resource inventory at ${inventoryPath}; inspect it before retrying.`);
    }
  }
  const desired = new Map(resources.map(r => [r.path, r.content]));
  const nextInventory = Object.fromEntries(resources.map(r => [r.path, digest(r.content)]));
  const existing = await optionalRead(target);
  const match = existing?.match(marker);
  if (action === "uninstall" && existing !== undefined && !match) throw new Error(`Preserving unmanaged skill at ${target}; removal only owns a valid managed marker.`);
  const unmodified = !!match && digest(existing!.slice(0, match.index)) === match[1];
  type Pending = { file: string; desired?: Buffer | string; existing?: Buffer | string; customized: boolean };
  const pending: Pending[] = [{ file: target, ...(action === "uninstall" ? {} : { desired: content }), ...(existing === undefined ? {} : { existing }), customized: existing !== undefined && !unmodified }];
  for (const name of new Set([...Object.keys(previous), ...desired.keys()])) {
    if (!safeResourceName(name)) throw new Error(`Unsafe resource path ${name}`);
    const file = path.join(directory, name);
    await checkDestination(root, file);
    let current: Buffer | undefined;
    try { current = await readFile(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    // Uninstall never owns a resource merely because the current package declares it.
    if (action === "uninstall" && previous[name] === undefined) continue;
    const customized = current !== undefined && (previous[name] === undefined || digest(current) !== previous[name]);
    const wanted = action === "uninstall" ? undefined : desired.get(name);
    pending.push({ file, customized, ...(current === undefined ? {} : { existing: current }), ...(wanted === undefined ? {} : { desired: wanted }) });
  }
  const customized = pending.some(p => p.customized);
  const same = (p: Pending): boolean => p.existing !== undefined && p.desired !== undefined && Buffer.from(p.existing).equals(Buffer.from(p.desired));
  const state = customized ? "customized" : pending.every(p => p.existing === undefined) ? "missing" : pending.every(p => same(p) || (p.existing === undefined && p.desired === undefined)) ? "current" : "outdated";
  const result: InstallResult = { skillId, platform, label: integrationPlatforms[platform].label, scope, path: target, state, action, dryRun: !!options.dryRun };
  if (action === "status") return result;
  if (customized && !options.force) throw new Error(`Preserving customized skill or resource at ${pending.find(p => p.customized)!.file}. Move it aside, or use --force to back it up and ${action}.`);
  if (options.dryRun) return result;
  // All paths and customizations are preflighted before changing any files.
  for (const p of pending) {
    if (same(p)) continue;
    if (p.customized) await writeFile(`${p.file}.${Date.now()}.${process.pid}.bak`, p.existing!, { flag: "wx" });
    if (p.desired === undefined) {
      if (p.existing !== undefined) await unlink(p.file);
    } else await atomicWrite(p.file, p.desired);
  }
  if (action === "uninstall" || resources.length === 0) {
    if (oldInventory !== undefined) await unlink(inventoryPath);
  } else await atomicWrite(inventoryPath, JSON.stringify(nextInventory, null, 2) + "\n");
  return { ...result, state: action === "install" ? "current" : "missing" };
}

function safeResourceName(name: string): boolean {
  return !!name && !path.isAbsolute(name) && !name.includes("\\") && !name.split("/").some(p => !p || p === "." || p === "..") && name !== "SKILL.md" && !name.startsWith(".fehm-");
}

async function atomicWrite(target: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

/** The first-party entry skill shares the catalog installer and managed-file lifecycle. */
export async function manageIntegration(action: "install" | "uninstall" | "status", options: InstallOptions): Promise<InstallResult> {
  const template = readFileSync(fileURLToPath(new URL("../integrations/fehm/SKILL.md", import.meta.url)), "utf8");
  return manageSkill({
    get: () => ({ license: "MIT" }),
    source: () => template,
    resourceFiles: () => [],
  }, "fehm", action, options);
}
