import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../third_party/open-code-review/', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const platform = `${process.platform}-${process.arch}`;
const asset = manifest.assets[platform];
if (!asset) throw new Error(`Open Code Review does not have a pinned engine for ${platform}`);
const target = path.join(root, 'bin', platform, process.platform === 'win32' ? 'ocr.exe' : 'ocr');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
if (digest(await readFile(path.join(root, 'source.tar.gz'))) !== manifest.sourceSha256) throw new Error('Vendored source archive checksum mismatch');
let bytes;
try { bytes = await readFile(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (!bytes || digest(bytes) !== asset.sha256) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Engine download failed (${response.status})`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== asset.sha256) throw new Error('Open Code Review checksum mismatch; refusing engine');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target + '.tmp', bytes, { mode: 0o755 });
  await rename(target + '.tmp', target);
}
await chmod(target, 0o755);
console.log(`Verified Open Code Review ${manifest.version} for ${platform}`);
