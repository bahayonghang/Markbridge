import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectNativeArtifact } from '../../../../../../scripts/native-build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const exe = resolve(root, 'target/release/markbridge-desktop.exe');
const data = await readFile(exe);
inspectNativeArtifact(data);
console.log(`Native scan path: ${exe}`);
console.log(`Native scan bytes: ${data.length}`);
console.log(`Native scan SHA256: ${createHash('sha256').update(data).digest('hex')}`);
await import(pathToFileURL(resolve(root, 'scripts/check-artifacts.mjs')).href);
