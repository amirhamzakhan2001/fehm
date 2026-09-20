import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

export async function resolveReviewEngine() {
  const root = fileURLToPath(new URL('../third_party/open-code-review/', import.meta.url));
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const platform = `${process.platform}-${process.arch}`;
  const executable = path.join(root, 'bin', platform, process.platform === 'win32' ? 'ocr.exe' : 'ocr');
  let bytes: Buffer;
  try { bytes = await readFile(executable); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Preserve source/npm installations that previously used an external executable.
    return { executable: 'ocr', version: 'external', bundled: false };
  }
  const expected = manifest.assets[platform]?.sha256;
  if (!expected || createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Bundled Open Code Review checksum mismatch. Reinstall Fehm.');
  return { executable, version: manifest.version as string, bundled: true };
}

export async function configureReviewEngine(args: string[]): Promise<void> {
  if (args.length !== 1 || !['provider', 'model'].includes(args[0]!)) throw new Error('Use fehm review configure provider|model');
  const engine = await resolveReviewEngine();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(engine.executable, ['config', args[0]!], { stdio: 'inherit', shell: false });
    child.on('error', () => reject(new Error('Cannot start Open Code Review. Reinstall the bundled wheel or prepare the source engine.')));
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('Open Code Review configuration did not complete.')));
  });
}
