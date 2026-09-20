import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Write a file atomically without sharing a temporary name across concurrent calls. */
export async function atomicWriteFile(destination: string, contents: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}-${Date.now()}-${randomUUID()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, destination);
}

export async function atomicWriteJson(destination: string, value: unknown): Promise<void> {
  await atomicWriteFile(destination, `${JSON.stringify(value, null, 2)}\n`);
}
