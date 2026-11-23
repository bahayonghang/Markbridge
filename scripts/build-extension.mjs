import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectDirectoryEntries,
  createZipBuffer,
  displayPath,
  readExpectedExtensionId,
  readZipEntries,
  runExtensionViteBuild,
} from './build-crx.mjs';
import { extensionIdFromKey, inspectExtensionDist } from './check-artifacts.mjs';

export const DEFAULT_EXTENSION_OUT_DIR_REL_PATH = 'apps/extension/dist-extension';
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i;

export async function buildExtensionUnpacked({
  workspaceRoot,
  outZipPath,
  skipBuild = false,
  noZip = false,
  expectedExtensionId,
}) {
  const expectedId = expectedExtensionId ?? await readExpectedExtensionId(workspaceRoot);
  if (!skipBuild) {
    await runExtensionViteBuild(workspaceRoot);
  }

  const distDir = resolve(workspaceRoot, 'apps/extension/dist');
  const distManifest = await inspectExtensionDist(distDir, expectedId);
  const entries = await collectDirectoryEntries(distDir);

  if (noZip) {
    return {
      distDir,
      zipPath: null,
      extensionId: expectedId,
      version: distManifest.version,
      entryCount: entries.length,
      zipBytes: 0,
      zipSha256: null,
    };
  }

  const zipBuffer = createZipBuffer(entries);
  const parsed = readZipEntries(zipBuffer);
  const manifestRaw = parsed.get('manifest.json');
  assert.ok(manifestRaw, 'Extension ZIP archive is missing manifest.json.');
  const zipManifest = JSON.parse(manifestRaw.toString('utf8'));
  assert.equal(zipManifest.manifest_version, 3, 'Extension ZIP manifest_version must be 3.');
  assert.equal(extensionIdFromKey(zipManifest.key), expectedId, 'Extension ZIP manifest.key ID mismatch.');

  for (const [entryName, entryData] of parsed) {
    assert.ok(!entryName.endsWith('.map'), `Extension ZIP must not contain source maps: ${entryName}`);
    assert.ok(!entryName.endsWith('.pem'), `Extension ZIP must not contain key files: ${entryName}`);
    assert.doesNotMatch(entryData.toString('utf8'), PRIVATE_KEY_PATTERN, `Extension ZIP contains private key text: ${entryName}`);
  }

  const usingDefaultOut = !outZipPath;
  const resolvedOutDir = usingDefaultOut
    ? resolve(workspaceRoot, DEFAULT_EXTENSION_OUT_DIR_REL_PATH)
    : dirname(resolve(workspaceRoot, outZipPath));
  await mkdir(resolvedOutDir, { recursive: true });
  if (usingDefaultOut) {
    for (const item of await readdir(resolvedOutDir)) {
      if (item.startsWith('markbridge-extension-') && item.endsWith('.zip')) {
        await rm(join(resolvedOutDir, item));
      }
    }
  }
  const finalZipPath = usingDefaultOut
    ? join(resolvedOutDir, `markbridge-extension-${distManifest.version}.zip`)
    : resolve(workspaceRoot, outZipPath);
  await writeFile(finalZipPath, zipBuffer);

  return {
    distDir,
    zipPath: finalZipPath,
    extensionId: expectedId,
    version: distManifest.version,
    entryCount: entries.length,
    zipBytes: zipBuffer.length,
    zipSha256: createHash('sha256').update(zipBuffer).digest('hex'),
  };
}

export function parseExtensionCliArgs(argv) {
  const options = {
    skipBuild: false,
    noZip: false,
    help: false,
    outZipPath: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--skip-build') {
      options.skipBuild = true;
    } else if (arg === '--no-zip') {
      options.noZip = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--out') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error('Option --out requires a file path.');
      options.outZipPath = value;
      index += 1;
    } else if (arg.startsWith('--out=')) {
      const value = arg.slice(6);
      if (!value) throw new Error('Option --out requires a file path.');
      options.outZipPath = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

const isEntry = process.argv[1]
  && (process.platform === 'win32'
    ? resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
    : resolve(process.argv[1]) === fileURLToPath(import.meta.url));

if (isEntry) {
  const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
  try {
    const options = parseExtensionCliArgs(process.argv.slice(2));
    if (options.help) {
      console.log([
        'Usage: node scripts/build-extension.mjs [options]',
        '',
        'Options:',
        '  --out <path>    Output portable .zip path (default: apps/extension/dist-extension/markbridge-extension-<version>.zip)',
        '  --skip-build    Validate and pack existing apps/extension/dist without running vite build',
        '  --no-zip        Build and validate unpacked apps/extension/dist only without writing a .zip archive',
        '  -h, --help      Show this help message',
      ].join('\n'));
      process.exit(0);
    }
    const built = await buildExtensionUnpacked({
      workspaceRoot,
      outZipPath: options.outZipPath,
      skipBuild: options.skipBuild,
      noZip: options.noZip,
    });
    const distLabel = displayPath(workspaceRoot, built.distDir);
    if (built.zipPath) {
      console.log(
        `Unpacked Chrome extension: PASS; dir=${distLabel}; zip=${displayPath(workspaceRoot, built.zipPath)}; id=${built.extensionId}; version=${built.version}; ${built.entryCount} entries; ${built.zipBytes} bytes; SHA256 ${built.zipSha256}.`,
      );
    } else {
      console.log(
        `Unpacked Chrome extension: PASS; dir=${distLabel}; id=${built.extensionId}; version=${built.version}; ${built.entryCount} entries.`,
      );
    }
    console.log(`Unpacked dir: ${built.distDir}`);
    if (built.zipPath) {
      console.log(`Portable zip: ${built.zipPath}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
