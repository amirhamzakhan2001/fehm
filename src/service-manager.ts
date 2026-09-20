import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ServiceStatus {
  platform: NodeJS.Platform;
  installed: boolean;
  running: boolean;
  servicePath?: string;
  detail: string;
}

function serviceId(root: string): string {
  const suffix = createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 12);
  return `com.fehm.sync.${suffix}`;
}

async function exists(candidate: string): Promise<boolean> {
  try { await access(candidate); return true; } catch { return false; }
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function locations(root: string): { id: string; servicePath?: string } {
  const id = serviceId(root);
  if (process.platform === "darwin") return { id, servicePath: path.join(os.homedir(), "Library", "LaunchAgents", `${id}.plist`) };
  if (process.platform === "linux") return { id, servicePath: path.join(os.homedir(), ".config", "systemd", "user", `${id}.service`) };
  return { id };
}

export async function installBackgroundService(root: string, cliPath: string, intervalMs = 2_000): Promise<ServiceStatus> {
  const repository = path.resolve(root);
  const executable = process.execPath;
  const { id, servicePath } = locations(repository);
  if (process.platform === "darwin" && servicePath) {
    const logDirectory = path.join(repository, ".fehm", "logs");
    await Promise.all([mkdir(path.dirname(servicePath), { recursive: true }), mkdir(logDirectory, { recursive: true })]);
    const content = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${xml(id)}</string>\n<key>ProgramArguments</key><array><string>${xml(executable)}</string><string>${xml(path.resolve(cliPath))}</string><string>watch</string><string>${xml(repository)}</string><string>--interval</string><string>${intervalMs}</string></array>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>\n<key>StandardOutPath</key><string>${xml(path.join(logDirectory, "service.log"))}</string>\n<key>StandardErrorPath</key><string>${xml(path.join(logDirectory, "service.error.log"))}</string>\n</dict></plist>\n`;
    if (await exists(servicePath)) {
      try { await execFileAsync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, servicePath]); } catch { /* service may already be stopped */ }
    }
    await writeFile(servicePath, content, "utf8");
    await execFileAsync("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 0}`, servicePath]);
    return { platform: process.platform, installed: true, running: true, servicePath, detail: `LaunchAgent ${id} installed` };
  }
  if (process.platform === "linux" && servicePath) {
    await mkdir(path.dirname(servicePath), { recursive: true });
    const content = `[Unit]\nDescription=fehm synchronization for ${repository}\nAfter=default.target\n\n[Service]\nType=simple\nWorkingDirectory=${repository}\nExecStart=${executable} ${path.resolve(cliPath)} watch ${repository} --interval ${intervalMs}\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n`;
    await writeFile(servicePath, content, "utf8");
    await execFileAsync("systemctl", ["--user", "daemon-reload"]);
    await execFileAsync("systemctl", ["--user", "enable", "--now", id]);
    return { platform: process.platform, installed: true, running: true, servicePath, detail: `systemd user service ${id} installed` };
  }
  if (process.platform === "win32") {
    const command = `\"${executable}\" \"${path.resolve(cliPath)}\" watch \"${repository}\" --interval ${intervalMs}`;
    await execFileAsync("schtasks", ["/Create", "/F", "/SC", "ONLOGON", "/TN", id, "/TR", command]);
    await execFileAsync("schtasks", ["/Run", "/TN", id]);
    return { platform: process.platform, installed: true, running: true, detail: `Scheduled task ${id} installed` };
  }
  throw new Error(`background services are not supported on ${process.platform}`);
}

export async function backgroundServiceStatus(root: string): Promise<ServiceStatus> {
  const { id, servicePath } = locations(root);
  if (process.platform === "darwin") {
    const installed = Boolean(servicePath && await exists(servicePath));
    try { await execFileAsync("launchctl", ["print", `gui/${process.getuid?.() ?? 0}/${id}`]); return { platform: process.platform, installed, running: true, ...(servicePath ? { servicePath } : {}), detail: id }; } catch { return { platform: process.platform, installed, running: false, ...(servicePath ? { servicePath } : {}), detail: id }; }
  }
  if (process.platform === "linux") {
    const installed = Boolean(servicePath && await exists(servicePath));
    try { await execFileAsync("systemctl", ["--user", "is-active", "--quiet", id]); return { platform: process.platform, installed, running: true, ...(servicePath ? { servicePath } : {}), detail: id }; } catch { return { platform: process.platform, installed, running: false, ...(servicePath ? { servicePath } : {}), detail: id }; }
  }
  if (process.platform === "win32") {
    try { const value = await execFileAsync("schtasks", ["/Query", "/TN", id, "/FO", "LIST"]); return { platform: process.platform, installed: true, running: /Running/i.test(value.stdout), detail: id }; } catch { return { platform: process.platform, installed: false, running: false, detail: id }; }
  }
  return { platform: process.platform, installed: false, running: false, detail: "unsupported platform" };
}

export async function uninstallBackgroundService(root: string): Promise<ServiceStatus> {
  const { id, servicePath } = locations(root);
  if (process.platform === "darwin" && servicePath) {
    try { await execFileAsync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, servicePath]); } catch { /* already stopped */ }
    if (await exists(servicePath)) await unlink(servicePath);
  } else if (process.platform === "linux" && servicePath) {
    try { await execFileAsync("systemctl", ["--user", "disable", "--now", id]); } catch { /* already stopped */ }
    if (await exists(servicePath)) await unlink(servicePath);
    await execFileAsync("systemctl", ["--user", "daemon-reload"]);
  } else if (process.platform === "win32") {
    try { await execFileAsync("schtasks", ["/Delete", "/F", "/TN", id]); } catch { /* already absent */ }
  }
  return backgroundServiceStatus(root);
}
