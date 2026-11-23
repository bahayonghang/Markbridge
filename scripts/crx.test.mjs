import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extensionIdFromKey } from './check-artifacts.mjs';
import { buildExtensionUnpacked, parseExtensionCliArgs } from './build-extension.mjs';
import {
  buildExtensionCrx,
  createZipBuffer,
  packCrx3,
  parseCliArgs,
  readZipEntries,
  rotateExtensionIdentity,
  verifyCrx3,
} from './build-crx.mjs';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));

function generateRsa2048Pair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const publicKeyBase64 = publicKey.toString('base64');
  return {
    privateKey,
    publicKeyBase64,
    extensionId: extensionIdFromKey(publicKeyBase64),
  };
}

function buildMinimalExtensionFiles(keyBase64, version = '0.1.0') {
  const manifest = {
    manifest_version: 3,
    name: 'Markbridge Test',
    version,
    key: keyBase64,
    permissions: ['bookmarks', 'storage', 'alarms', 'scripting', 'activeTab'],
    action: { default_popup: 'index.html' },
    options_ui: { page: 'options.html', open_in_tab: true },
    background: { service_worker: 'worker.js', type: 'module' },
  };
  return [
    { name: 'assets/main.js', data: Buffer.from('console.log("ok");\n'.repeat(20), 'utf8') },
    { name: 'index.html', data: Buffer.from('<!doctype html><html><body>popup</body></html>', 'utf8') },
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { name: 'options.html', data: Buffer.from('<!doctype html><html><body>options</body></html>', 'utf8') },
    { name: 'worker.js', data: Buffer.from('export const ready = true;\n', 'utf8') },
  ];
}

test('ZIP builder creates deterministic DEFLATE/STORE archives and detects CRC corruption', () => {
  const entries = [
    { name: 'a/compressible.txt', data: Buffer.from('markbridge-'.repeat(40), 'utf8') },
    { name: 'b/tiny.bin', data: Buffer.from([1, 2, 3]) },
  ];
  const first = createZipBuffer(entries);
  const second = createZipBuffer(entries);
  assert.ok(first.equals(second), 'ZIP output must be deterministic across builds');

  const parsed = readZipEntries(first);
  assert.deepEqual([...parsed.keys()], ['a/compressible.txt', 'b/tiny.bin']);
  assert.ok(parsed.get('a/compressible.txt').equals(entries[0].data));
  assert.ok(parsed.get('b/tiny.bin').equals(entries[1].data));

  const corrupted = Buffer.from(first);
  const tinyDataOffset = corrupted.indexOf('tiny.bin') + 'tiny.bin'.length + 1;
  corrupted[tinyDataOffset] ^= 0xff;
  assert.throws(() => readZipEntries(corrupted), /CRC-32 mismatch/);
});

test('packCrx3 and verifyCrx3 round-trip valid packages and reject tampering or weak keys', () => {
  const pair = generateRsa2048Pair();
  const entries = buildMinimalExtensionFiles(pair.publicKeyBase64);
  const zip = createZipBuffer(entries);
  const packed = packCrx3(zip, pair.privateKey);
  assert.equal(packed.extensionId, pair.extensionId);
  assert.equal(packed.crx.subarray(0, 4).toString('ascii'), 'Cr24');
  assert.equal(packed.crx.readUInt32LE(4), 3);

  const verified = verifyCrx3(packed.crx, pair.extensionId);
  assert.equal(verified.extensionId, pair.extensionId);
  assert.equal(verified.publicKeyBase64, pair.publicKeyBase64);
  assert.deepEqual(verified.entryNames, entries.map((item) => item.name));

  assert.throws(() => verifyCrx3(packed.crx, 'a'.repeat(32)), /extension ID mismatch/);

  const badZip = Buffer.from(packed.crx);
  badZip[badZip.length - 1] ^= 0xff;
  assert.throws(() => verifyCrx3(badZip, pair.extensionId), /signature verification failed/);

  const headerSize = packed.crx.readUInt32LE(8);
  const badSig = Buffer.from(packed.crx);
  badSig[12 + 350] ^= 0x01;
  assert.throws(() => verifyCrx3(badSig, pair.extensionId), /signature verification failed/);

  const badCrxId = Buffer.from(packed.crx);
  badCrxId[12 + headerSize - 10] ^= 0x01;
  assert.throws(() => verifyCrx3(badCrxId, pair.extensionId), /extension ID mismatch/);

  const weakKey = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  assert.throws(() => packCrx3(zip, weakKey.privateKey), /at least 2048 bits/);
});

test('rotateExtensionIdentity aligns all 4 identity files and refuses overwrite without --force', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'markbridge-crx-rotate-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const files = [
    'apps/extension/public/manifest.json',
    'crates/protocol/src/lib.rs',
    'packages/protocol/src/index.ts',
    'scripts/check-artifacts.mjs',
  ];
  for (const rel of files) {
    const dest = join(root, rel);
    await mkdir(join(dest, '..'), { recursive: true });
    await copyFile(join(workspaceRoot, rel), dest);
  }

  const rotated = await rotateExtensionIdentity({ workspaceRoot: root });
  assert.match(rotated.extensionId, /^[a-p]{32}$/);

  const manifest = JSON.parse(await readFile(join(root, 'apps/extension/public/manifest.json'), 'utf8'));
  assert.equal(extensionIdFromKey(manifest.key), rotated.extensionId);
  assert.equal(manifest.key, rotated.publicKeyBase64);

  const rustLib = await readFile(join(root, 'crates/protocol/src/lib.rs'), 'utf8');
  assert.match(rustLib, new RegExp(`OFFICIAL_EXTENSION_ID: &str = "${rotated.extensionId}";`));
  assert.match(rustLib, new RegExp(`OFFICIAL_EXTENSION_ORIGIN: &str = "chrome-extension://${rotated.extensionId}";`));

  const tsIndex = await readFile(join(root, 'packages/protocol/src/index.ts'), 'utf8');
  assert.match(tsIndex, new RegExp(`OFFICIAL_EXTENSION_ID = '${rotated.extensionId}' as const;`));
  assert.match(tsIndex, new RegExp(`OFFICIAL_EXTENSION_ORIGIN = 'chrome-extension://${rotated.extensionId}' as const;`));

  const checkArtifacts = await readFile(join(root, 'scripts/check-artifacts.mjs'), 'utf8');
  assert.match(checkArtifacts, new RegExp(`OFFICIAL_EXTENSION_ID = '${rotated.extensionId}';`));

  await assert.rejects(
    () => rotateExtensionIdentity({ workspaceRoot: root }),
    /Refusing to overwrite existing CRX signing key/,
  );

  const forced = await rotateExtensionIdentity({ workspaceRoot: root, force: true });
  assert.notEqual(forced.extensionId, rotated.extensionId);

  const distDir = join(root, 'apps/extension/dist');
  await mkdir(distDir, { recursive: true });
  for (const entry of buildMinimalExtensionFiles(forced.publicKeyBase64, '0.1.0')) {
    const filePath = join(distDir, entry.name);
    await mkdir(join(filePath, '..'), { recursive: true });
    await writeFile(filePath, entry.data);
  }

  const built = await buildExtensionCrx({
    workspaceRoot: root,
    skipBuild: true,
    expectedExtensionId: forced.extensionId,
  });
  assert.equal(built.extensionId, forced.extensionId);
  const crxBytes = await readFile(built.outPath);
  const verified = verifyCrx3(crxBytes, forced.extensionId);
  assert.equal(verified.manifest.version, '0.1.0');
});

test('buildExtensionCrx rejects mismatched private key', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'markbridge-crx-mismatch-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const manifestDir = join(root, 'apps/extension/public');
  await mkdir(manifestDir, { recursive: true });
  await copyFile(join(workspaceRoot, 'apps/extension/public/manifest.json'), join(manifestDir, 'manifest.json'));
  await mkdir(join(root, 'scripts'), { recursive: true });
  await copyFile(join(workspaceRoot, 'scripts/check-artifacts.mjs'), join(root, 'scripts/check-artifacts.mjs'));

  const wrongPair = generateRsa2048Pair();
  const wrongKeyPath = join(root, 'wrong.pem');
  await writeFile(wrongKeyPath, wrongPair.privateKey, 'utf8');

  await assert.rejects(
    () => buildExtensionCrx({ workspaceRoot: root, keyPath: wrongKeyPath, skipBuild: true }),
    /does not match official ID/,
  );
});

test('parseCliArgs parses CRX flags and rejects unknown flags', () => {
  assert.deepEqual(
    parseCliArgs(['--key', 'a.pem', '--out=out.crx', '--skip-build']),
    { rotateKey: false, force: false, skipBuild: true, help: false, keyPath: 'a.pem', outPath: 'out.crx' },
  );
  assert.throws(() => parseCliArgs(['--unknown']), /Unknown option/);
  assert.throws(() => parseCliArgs(['--key']), /requires a file path/);
});

test('buildExtensionUnpacked validates dist without a private key, packs portable ZIP, and cleans stale ZIPs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'markbridge-ext-unpacked-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const pair = generateRsa2048Pair();
  await mkdir(join(root, 'scripts'), { recursive: true });
  await copyFile(join(workspaceRoot, 'scripts/check-artifacts.mjs'), join(root, 'scripts/check-artifacts.mjs'));

  const distDir = join(root, 'apps/extension/dist');
  await mkdir(distDir, { recursive: true });
  const entries = buildMinimalExtensionFiles(pair.publicKeyBase64, '0.1.0');
  for (const entry of entries) {
    const filePath = join(distDir, entry.name);
    await mkdir(join(filePath, '..'), { recursive: true });
    await writeFile(filePath, entry.data);
  }

  const outDir = join(root, 'apps/extension/dist-extension');
  await mkdir(outDir, { recursive: true });
  const staleZip = join(outDir, 'markbridge-extension-0.0.9.zip');
  await writeFile(staleZip, Buffer.from('stale'));

  const built = await buildExtensionUnpacked({
    workspaceRoot: root,
    skipBuild: true,
    expectedExtensionId: pair.extensionId,
  });
  assert.equal(built.extensionId, pair.extensionId);
  assert.equal(built.version, '0.1.0');
  assert.equal(built.entryCount, entries.length);
  assert.ok(built.zipPath && built.zipPath.endsWith('markbridge-extension-0.1.0.zip'));
  await assert.rejects(() => readFile(staleZip), /ENOENT/);

  const parsed = readZipEntries(await readFile(built.zipPath));
  assert.deepEqual([...parsed.keys()], entries.map((item) => item.name));
  const zipManifest = JSON.parse(parsed.get('manifest.json').toString('utf8'));
  assert.equal(zipManifest.key, pair.publicKeyBase64);

  const noZipResult = await buildExtensionUnpacked({
    workspaceRoot: root,
    skipBuild: true,
    noZip: true,
    expectedExtensionId: pair.extensionId,
  });
  assert.equal(noZipResult.zipPath, null);
  assert.equal(noZipResult.zipBytes, 0);
  assert.equal(noZipResult.zipSha256, null);
});

test('parseExtensionCliArgs parses flags and rejects unknown flags', () => {
  assert.deepEqual(
    parseExtensionCliArgs(['--out=ext.zip', '--skip-build', '--no-zip']),
    { skipBuild: true, noZip: true, help: false, outZipPath: 'ext.zip' },
  );
  assert.throws(() => parseExtensionCliArgs(['--unknown']), /Unknown option/);
  assert.throws(() => parseExtensionCliArgs(['--out']), /requires a file path/);
});

test('CRX keys and artifacts remain untracked by Git and ignored in .gitignore', async () => {
  const gitignore = await readFile(join(workspaceRoot, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\/apps\/extension\/dist-crx\/$/m);
  assert.match(gitignore, /^\/apps\/extension\/dist-extension\/$/m);
  assert.match(gitignore, /^\/apps\/extension\/\.keys\/$/m);
  assert.match(gitignore, /^\*\.pem$/m);

  const tracked = execFileSync(
    'git',
    ['ls-files', '--', '*.pem', 'apps/extension/.keys', 'apps/extension/dist-crx', 'apps/extension/dist-extension'],
    { cwd: workspaceRoot, encoding: 'utf8' },
  );
  assert.equal(tracked.trim(), '');
});
