import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, constants } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { extensionIdFromKey, inspectExtensionDist } from './check-artifacts.mjs';
import { runVisible } from './run-command.mjs';

export const DEFAULT_KEY_REL_PATH = 'apps/extension/.keys/extension.pem';
export const DEFAULT_OUT_DIR_REL_PATH = 'apps/extension/dist-crx';
export const CRX3_MAGIC = Buffer.from('Cr24', 'ascii');
export const CRX3_VERSION = 3;
export const CRX3_SIGNED_DATA_PREFIX = Buffer.from('CRX3 SignedData\0', 'ascii');

const ZIP_LOCAL_HEADER_SIG = 0x04034b50;
const ZIP_CENTRAL_HEADER_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
const ZIP_DOS_TIME = 0x0000;
const ZIP_DOS_DATE = 0x0021; // 1980-01-01
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i;

export function displayPath(workspaceRoot, targetPath) {
  const rel = relative(workspaceRoot, targetPath);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
    return rel.replace(/\\/g, '/');
  }
  return basename(targetPath);
}

export function extensionIdFromCrxId(crxId) {
  assert.ok(Buffer.isBuffer(crxId) && crxId.length === 16, 'CRX ID must be 16 bytes.');
  return [...crxId].map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 0x0f))).join('');
}

export function publicKeyDerFromPrivateKey(privateKey) {
  assert.equal(privateKey.asymmetricKeyType, 'rsa', 'CRX3 signing key must be an RSA key.');
  const modulusLength = privateKey.asymmetricKeyDetails?.modulusLength ?? 0;
  assert.ok(modulusLength >= 2048, `CRX3 RSA signing key must be at least 2048 bits (got ${modulusLength}).`);
  return createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
}

export async function collectDirectoryEntries(rootDir) {
  const entries = [];
  async function walk(currentDir, prefix) {
    const dirents = await readdir(currentDir, { withFileTypes: true });
    for (const dirent of dirents) {
      const fullPath = join(currentDir, dirent.name);
      const stat = await lstat(fullPath);
      assert.ok(!stat.isSymbolicLink(), `Extension dist must not contain symbolic links: ${dirent.name}`);
      const relName = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      if (stat.isDirectory()) {
        await walk(fullPath, relName);
      } else if (stat.isFile()) {
        entries.push({ name: relName, data: await readFile(fullPath) });
      }
    }
  }
  await walk(rootDir, '');
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

export function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    assert.equal(typeof entry.name, 'string', 'ZIP entry name must be a string.');
    assert.ok(entry.name.length > 0 && !entry.name.startsWith('/') && !entry.name.includes('\\'), `Invalid ZIP entry path: ${entry.name}`);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data) >>> 0;
    const compressed = deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const method = useDeflate ? ZIP_METHOD_DEFLATE : ZIP_METHOD_STORE;
    const payload = useDeflate ? compressed : data;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(ZIP_LOCAL_HEADER_SIG, 0);
    localHeader.writeUInt16LE(ZIP_VERSION, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(ZIP_DOS_TIME, 10);
    localHeader.writeUInt16LE(ZIP_DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBytes, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_HEADER_SIG, 0);
    centralHeader.writeUInt16LE(ZIP_VERSION, 4);
    centralHeader.writeUInt16LE(ZIP_VERSION, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(ZIP_DOS_TIME, 12);
    centralHeader.writeUInt16LE(ZIP_DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(ZIP_EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

export function readZipEntries(zipBuffer) {
  assert.ok(Buffer.isBuffer(zipBuffer) && zipBuffer.length >= 22, 'Invalid ZIP buffer.');
  let eocdOffset = -1;
  const minOffset = Math.max(0, zipBuffer.length - 65557);
  for (let pos = zipBuffer.length - 22; pos >= minOffset; pos -= 1) {
    if (zipBuffer.readUInt32LE(pos) === ZIP_EOCD_SIG) {
      const commentLength = zipBuffer.readUInt16LE(pos + 20);
      if (pos + 22 + commentLength === zipBuffer.length) {
        eocdOffset = pos;
        break;
      }
    }
  }
  assert.ok(eocdOffset >= 0, 'ZIP End of Central Directory record not found.');

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  assert.ok(cdOffset + cdSize <= eocdOffset, 'ZIP Central Directory exceeds archive bounds.');

  const entries = new Map();
  let cursor = cdOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    assert.ok(cursor + 46 <= cdOffset + cdSize, 'Truncated ZIP Central Directory entry.');
    assert.equal(zipBuffer.readUInt32LE(cursor), ZIP_CENTRAL_HEADER_SIG, 'Invalid ZIP Central Directory signature.');
    const method = zipBuffer.readUInt16LE(cursor + 10);
    const expectedCrc = zipBuffer.readUInt32LE(cursor + 16);
    const compressedSize = zipBuffer.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(cursor + 24);
    const nameLen = zipBuffer.readUInt16LE(cursor + 28);
    const extraLen = zipBuffer.readUInt16LE(cursor + 30);
    const commentLen = zipBuffer.readUInt16LE(cursor + 32);
    const localOffset = zipBuffer.readUInt32LE(cursor + 42);
    assert.ok(cursor + 46 + nameLen + extraLen + commentLen <= cdOffset + cdSize, 'ZIP Central Directory metadata out of range.');

    const name = zipBuffer.toString('utf8', cursor + 46, cursor + 46 + nameLen);
    cursor += 46 + nameLen + extraLen + commentLen;

    assert.ok(localOffset + 30 <= cdOffset, 'ZIP local header offset out of range.');
    assert.equal(zipBuffer.readUInt32LE(localOffset), ZIP_LOCAL_HEADER_SIG, `Invalid local header for ${name}`);
    const localNameLen = zipBuffer.readUInt16LE(localOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    assert.ok(dataEnd <= cdOffset, `ZIP compressed data out of range for ${name}`);

    const compressedSlice = zipBuffer.subarray(dataStart, dataEnd);
    let data;
    if (method === ZIP_METHOD_STORE) {
      data = Buffer.from(compressedSlice);
    } else if (method === ZIP_METHOD_DEFLATE) {
      data = inflateRawSync(compressedSlice);
    } else {
      assert.fail(`Unsupported ZIP compression method ${method} for ${name}`);
    }
    assert.equal(data.length, uncompressedSize, `Uncompressed size mismatch for ${name}`);
    assert.equal(crc32(data) >>> 0, expectedCrc, `CRC-32 mismatch for ${name}`);
    entries.set(name, data);
  }
  assert.equal(cursor, cdOffset + cdSize, 'ZIP Central Directory trailing bytes detected.');
  return entries;
}

export function encodeVarint(value) {
  assert.ok(Number.isSafeInteger(value) && value >= 0, `Invalid protobuf varint value: ${value}`);
  const bytes = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

export function decodeVarint(buffer, offset) {
  let result = 0;
  let multiplier = 1;
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    cursor += 1;
    result += (byte & 0x7f) * multiplier;
    assert.ok(Number.isSafeInteger(result), 'Protobuf varint overflow.');
    if ((byte & 0x80) === 0) {
      return { value: result, nextOffset: cursor };
    }
    multiplier *= 128;
  }
  assert.fail('Truncated protobuf varint.');
}

export function encodeLengthDelimited(fieldNumber, payload) {
  const tag = encodeVarint(fieldNumber * 8 + 2);
  const length = encodeVarint(payload.length);
  return Buffer.concat([tag, length, payload]);
}

export function decodeProtobufFields(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tagInfo = decodeVarint(buffer, offset);
    offset = tagInfo.nextOffset;
    const wireType = tagInfo.value % 8;
    const fieldNumber = Math.floor(tagInfo.value / 8);
    assert.ok(fieldNumber > 0, 'Invalid protobuf field number 0.');
    assert.equal(wireType, 2, `Unsupported CRX3 protobuf wire type ${wireType} on field ${fieldNumber}.`);
    const lenInfo = decodeVarint(buffer, offset);
    offset = lenInfo.nextOffset;
    assert.ok(offset + lenInfo.value <= buffer.length, `Truncated protobuf field ${fieldNumber}.`);
    fields.push({ fieldNumber, wireType, value: buffer.subarray(offset, offset + lenInfo.value) });
    offset += lenInfo.value;
  }
  return fields;
}

export function packCrx3(zipBuffer, privateKeyInput) {
  assert.ok(Buffer.isBuffer(zipBuffer) && zipBuffer.length > 0, 'ZIP payload must be a non-empty Buffer.');
  const privateKey = typeof privateKeyInput === 'string' || Buffer.isBuffer(privateKeyInput)
    ? createPrivateKey(privateKeyInput)
    : privateKeyInput;
  const spkiDer = publicKeyDerFromPrivateKey(privateKey);
  const crxId = createHash('sha256').update(spkiDer).digest().subarray(0, 16);
  const signedHeaderData = encodeLengthDelimited(1, crxId);

  const signedHeaderLength = Buffer.alloc(4);
  signedHeaderLength.writeUInt32LE(signedHeaderData.length, 0);
  const signedInput = Buffer.concat([CRX3_SIGNED_DATA_PREFIX, signedHeaderLength, signedHeaderData, zipBuffer]);
  const signature = sign('sha256', signedInput, { key: privateKey, padding: constants.RSA_PKCS1_PADDING });

  const proof = Buffer.concat([
    encodeLengthDelimited(1, spkiDer),
    encodeLengthDelimited(2, signature),
  ]);
  const header = Buffer.concat([
    encodeLengthDelimited(2, proof),
    encodeLengthDelimited(10000, signedHeaderData),
  ]);

  const envelope = Buffer.alloc(12);
  CRX3_MAGIC.copy(envelope, 0);
  envelope.writeUInt32LE(CRX3_VERSION, 4);
  envelope.writeUInt32LE(header.length, 8);

  return {
    crx: Buffer.concat([envelope, header, zipBuffer]),
    extensionId: extensionIdFromCrxId(crxId),
    publicKeyBase64: spkiDer.toString('base64'),
  };
}

export function verifyCrx3(crxBuffer, expectedExtensionId) {
  assert.ok(Buffer.isBuffer(crxBuffer) && crxBuffer.length >= 12, 'CRX3 archive is smaller than 12-byte header.');
  assert.ok(crxBuffer.subarray(0, 4).equals(CRX3_MAGIC), 'CRX3 archive magic must be Cr24.');
  assert.equal(crxBuffer.readUInt32LE(4), CRX3_VERSION, 'CRX archive version must be 3.');
  const headerSize = crxBuffer.readUInt32LE(8);
  assert.ok(headerSize > 0 && 12 + headerSize <= crxBuffer.length, 'CRX3 header size is out of bounds.');

  const headerBytes = crxBuffer.subarray(12, 12 + headerSize);
  const zipBytes = crxBuffer.subarray(12 + headerSize);
  const headerFields = decodeProtobufFields(headerBytes);

  const signedHeaderEntries = headerFields.filter((f) => f.fieldNumber === 10000);
  assert.equal(signedHeaderEntries.length, 1, 'CRX3 header must contain exactly one signed_header_data field.');
  const signedHeaderData = signedHeaderEntries[0].value;

  const signedDataFields = decodeProtobufFields(signedHeaderData);
  const crxIdFields = signedDataFields.filter((f) => f.fieldNumber === 1);
  assert.equal(crxIdFields.length, 1, 'CRX3 SignedData must contain crx_id.');
  const crxId = crxIdFields[0].value;
  const extensionId = extensionIdFromCrxId(crxId);
  if (expectedExtensionId !== undefined) {
    assert.equal(extensionId, expectedExtensionId, `CRX3 extension ID mismatch: expected ${expectedExtensionId}, got ${extensionId}.`);
  }

  const rsaProofs = headerFields.filter((f) => f.fieldNumber === 2);
  assert.ok(rsaProofs.length > 0, 'CRX3 header must contain at least one sha256_with_rsa proof.');

  const signedHeaderLength = Buffer.alloc(4);
  signedHeaderLength.writeUInt32LE(signedHeaderData.length, 0);
  const signedInput = Buffer.concat([CRX3_SIGNED_DATA_PREFIX, signedHeaderLength, signedHeaderData, zipBytes]);

  let matchedPublicKeyDer = null;
  for (const proofField of rsaProofs) {
    const proofItems = decodeProtobufFields(proofField.value);
    const keyField = proofItems.find((f) => f.fieldNumber === 1);
    const sigField = proofItems.find((f) => f.fieldNumber === 2);
    if (!keyField || !sigField) continue;
    const derivedCrxId = createHash('sha256').update(keyField.value).digest().subarray(0, 16);
    if (!derivedCrxId.equals(crxId)) continue;
    const publicKey = createPublicKey({ key: keyField.value, format: 'der', type: 'spki' });
    const ok = verify('sha256', signedInput, { key: publicKey, padding: constants.RSA_PKCS1_PADDING }, sigField.value);
    assert.ok(ok, 'CRX3 RSA-SHA256 signature verification failed.');
    matchedPublicKeyDer = keyField.value;
    break;
  }
  assert.ok(matchedPublicKeyDer, 'CRX3 header has no sha256_with_rsa proof matching crx_id.');

  const entries = readZipEntries(zipBytes);
  const manifestRaw = entries.get('manifest.json');
  assert.ok(manifestRaw, 'CRX3 ZIP payload is missing manifest.json.');
  const manifest = JSON.parse(manifestRaw.toString('utf8'));
  assert.equal(manifest.manifest_version, 3, 'CRX3 manifest_version must be 3.');
  const publicKeyBase64 = matchedPublicKeyDer.toString('base64');
  assert.equal(manifest.key, publicKeyBase64, 'CRX3 manifest.key does not match signing public key.');

  for (const [entryName, entryData] of entries) {
    assert.ok(!entryName.endsWith('.map'), `CRX3 must not contain source maps: ${entryName}`);
    assert.ok(!entryName.endsWith('.pem'), `CRX3 must not contain key files: ${entryName}`);
    assert.doesNotMatch(entryData.toString('utf8'), PRIVATE_KEY_PATTERN, `CRX3 entry contains private key text: ${entryName}`);
  }

  return {
    extensionId,
    publicKeyBase64,
    entryNames: [...entries.keys()],
    manifest,
    zipBytes,
  };
}

function replaceExactlyOnce(content, pattern, replacement, fileLabel) {
  let count = 0;
  const updated = content.replace(pattern, (...args) => {
    count += 1;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
  assert.equal(count, 1, `Expected 1 match in ${fileLabel}, found ${count}.`);
  return updated;
}

export async function rotateExtensionIdentity({ workspaceRoot, keyPath, force = false }) {
  const targetKeyPath = resolve(workspaceRoot, keyPath ?? DEFAULT_KEY_REL_PATH);
  if (!force && existsSync(targetKeyPath)) {
    throw new Error(
      `Refusing to overwrite existing CRX signing key at ${displayPath(workspaceRoot, targetKeyPath)}. Pass --force to replace it.`,
    );
  }

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const publicKeyBase64 = publicKey.toString('base64');
  const extensionId = extensionIdFromKey(publicKeyBase64);
  const extensionOrigin = `chrome-extension://${extensionId}`;

  await mkdir(dirname(targetKeyPath), { recursive: true });
  await writeFile(targetKeyPath, privateKey, { mode: 0o600, encoding: 'utf8' });

  const manifestPath = resolve(workspaceRoot, 'apps/extension/public/manifest.json');
  const rustProtocolPath = resolve(workspaceRoot, 'crates/protocol/src/lib.rs');
  const tsProtocolPath = resolve(workspaceRoot, 'packages/protocol/src/index.ts');
  const artifactsPath = resolve(workspaceRoot, 'scripts/check-artifacts.mjs');

  const replaceCaptured = (_match, prefix, suffix) => `${prefix}${extensionId}${suffix}`;
  const manifestUpdated = replaceExactlyOnce(
    await readFile(manifestPath, 'utf8'),
    /"key":\s*"[^"]+"/,
    () => `"key": "${publicKeyBase64}"`,
    'apps/extension/public/manifest.json',
  );
  let rustUpdated = replaceExactlyOnce(
    await readFile(rustProtocolPath, 'utf8'),
    /(pub const OFFICIAL_EXTENSION_ID: &str = ")[a-z]{32}(";)/,
    replaceCaptured,
    'crates/protocol/src/lib.rs (OFFICIAL_EXTENSION_ID)',
  );
  rustUpdated = replaceExactlyOnce(
    rustUpdated,
    /(pub const OFFICIAL_EXTENSION_ORIGIN: &str = "chrome-extension:\/\/)[a-z]{32}(";)/,
    replaceCaptured,
    'crates/protocol/src/lib.rs (OFFICIAL_EXTENSION_ORIGIN)',
  );
  let tsUpdated = replaceExactlyOnce(
    await readFile(tsProtocolPath, 'utf8'),
    /(export const OFFICIAL_EXTENSION_ID = ')[a-z]{32}(' as const;)/,
    replaceCaptured,
    'packages/protocol/src/index.ts (OFFICIAL_EXTENSION_ID)',
  );
  tsUpdated = replaceExactlyOnce(
    tsUpdated,
    /(export const OFFICIAL_EXTENSION_ORIGIN = 'chrome-extension:\/\/)[a-z]{32}(' as const;)/,
    replaceCaptured,
    'packages/protocol/src/index.ts (OFFICIAL_EXTENSION_ORIGIN)',
  );
  const artifactsUpdated = replaceExactlyOnce(
    await readFile(artifactsPath, 'utf8'),
    /(export const OFFICIAL_EXTENSION_ID = ')[a-z]{32}(';)/,
    replaceCaptured,
    'scripts/check-artifacts.mjs',
  );

  await Promise.all([
    writeFile(manifestPath, manifestUpdated, 'utf8'),
    writeFile(rustProtocolPath, rustUpdated, 'utf8'),
    writeFile(tsProtocolPath, tsUpdated, 'utf8'),
    writeFile(artifactsPath, artifactsUpdated, 'utf8'),
  ]);

  return { extensionId, extensionOrigin, publicKeyBase64, keyPath: targetKeyPath };
}

export async function readExpectedExtensionId(workspaceRoot) {
  const source = await readFile(resolve(workspaceRoot, 'scripts/check-artifacts.mjs'), 'utf8');
  const match = source.match(/export const OFFICIAL_EXTENSION_ID = '([a-z]{32})';/);
  assert.ok(match, 'Unable to read OFFICIAL_EXTENSION_ID from scripts/check-artifacts.mjs.');
  return match[1];
}

export async function runExtensionViteBuild(workspaceRoot) {
  const extensionDir = resolve(workspaceRoot, 'apps/extension');
  const viteCandidates = [
    resolve(extensionDir, 'node_modules/vite/bin/vite.js'),
    resolve(workspaceRoot, 'node_modules/vite/bin/vite.js'),
  ];
  const viteBin = viteCandidates.find((candidate) => existsSync(candidate));
  if (!viteBin) {
    throw new Error('Missing vite CLI (apps/extension/node_modules/vite/bin/vite.js). Run `just install` or `pnpm install --frozen-lockfile` first.');
  }
  const buildResult = await runVisible(process.execPath, [viteBin, 'build'], {
    cwd: extensionDir,
    idleNoticeMs: 0,
  });
  assert.equal(buildResult.status, 0, `Extension build failed with exit code ${buildResult.status ?? 'null'}.`);
}

export async function buildExtensionCrx({
  workspaceRoot,
  keyPath,
  outPath,
  skipBuild = false,
  expectedExtensionId,
}) {
  const resolvedKeyPath = resolve(
    workspaceRoot,
    keyPath ?? process.env.MARKBRIDGE_CRX_KEY ?? DEFAULT_KEY_REL_PATH,
  );
  if (!existsSync(resolvedKeyPath)) {
    throw new Error(
      `Missing CRX signing key (${displayPath(workspaceRoot, resolvedKeyPath)}). Provide --key <path>, set MARKBRIDGE_CRX_KEY, or run \`just crx-rotate-key\` to generate a local gitignored key and align the extension ID.`,
    );
  }

  const keyPem = await readFile(resolvedKeyPath, 'utf8');
  const privateKey = createPrivateKey(keyPem);
  const spkiDer = publicKeyDerFromPrivateKey(privateKey);
  const publicKeyBase64 = spkiDer.toString('base64');
  const derivedId = extensionIdFromKey(publicKeyBase64);
  const expectedId = expectedExtensionId ?? await readExpectedExtensionId(workspaceRoot);

  const sourceManifest = JSON.parse(
    await readFile(resolve(workspaceRoot, 'apps/extension/public/manifest.json'), 'utf8'),
  );
  if (publicKeyBase64 !== sourceManifest.key || derivedId !== expectedId) {
    throw new Error(
      `CRX signing key yields extension ID ${derivedId}, which does not match official ID ${expectedId} / manifest.key. Signing with a mismatched key produces a different Chrome extension ID that Markbridge Desktop rejects. Provide the matching private key or run \`just crx-rotate-key --force\` to rotate the key.`,
    );
  }

  if (!skipBuild) {
    await runExtensionViteBuild(workspaceRoot);
  }

  const distDir = resolve(workspaceRoot, 'apps/extension/dist');
  const distManifest = await inspectExtensionDist(distDir, expectedId);
  const entries = await collectDirectoryEntries(distDir);
  const zipBuffer = createZipBuffer(entries);
  const packed = packCrx3(zipBuffer, privateKey);
  verifyCrx3(packed.crx, expectedId);

  const usingDefaultOut = !outPath;
  const resolvedOutDir = usingDefaultOut
    ? resolve(workspaceRoot, DEFAULT_OUT_DIR_REL_PATH)
    : dirname(resolve(workspaceRoot, outPath));
  await mkdir(resolvedOutDir, { recursive: true });
  if (usingDefaultOut) {
    for (const item of await readdir(resolvedOutDir)) {
      if (item.startsWith('markbridge-extension-') && item.endsWith('.crx')) {
        await rm(join(resolvedOutDir, item));
      }
    }
  }
  const finalOutPath = usingDefaultOut
    ? join(resolvedOutDir, `markbridge-extension-${distManifest.version}.crx`)
    : resolve(workspaceRoot, outPath);
  await writeFile(finalOutPath, packed.crx);

  return {
    outPath: finalOutPath,
    extensionId: packed.extensionId,
    version: distManifest.version,
    bytes: packed.crx.length,
    sha256: createHash('sha256').update(packed.crx).digest('hex'),
    entryCount: entries.length,
  };
}

export function parseCliArgs(argv) {
  const options = {
    rotateKey: false,
    force: false,
    skipBuild: false,
    help: false,
    keyPath: undefined,
    outPath: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--rotate-key') {
      options.rotateKey = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--skip-build') {
      options.skipBuild = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--key') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error('Option --key requires a file path.');
      options.keyPath = value;
      index += 1;
    } else if (arg.startsWith('--key=')) {
      const value = arg.slice(6);
      if (!value) throw new Error('Option --key requires a file path.');
      options.keyPath = value;
    } else if (arg === '--out') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw new Error('Option --out requires a file path.');
      options.outPath = value;
      index += 1;
    } else if (arg.startsWith('--out=')) {
      const value = arg.slice(6);
      if (!value) throw new Error('Option --out requires a file path.');
      options.outPath = value;
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
    const options = parseCliArgs(process.argv.slice(2));
    if (options.help) {
      console.log([
        'Usage: node scripts/build-crx.mjs [options]',
        '',
        'Options:',
        '  --key <path>    Path to RSA-2048 PEM private key (default: MARKBRIDGE_CRX_KEY or apps/extension/.keys/extension.pem)',
        '  --out <path>    Output .crx path (default: apps/extension/dist-crx/markbridge-extension-<version>.crx)',
        '  --skip-build    Pack existing apps/extension/dist without running vite build',
        '  --rotate-key    Generate a new gitignored RSA-2048 private key and update fixed extension ID files',
        '  --force         Overwrite existing private key when used with --rotate-key',
        '  -h, --help      Show this help message',
      ].join('\n'));
      process.exit(0);
    }
    if (options.rotateKey) {
      const rotated = await rotateExtensionIdentity({
        workspaceRoot,
        keyPath: options.keyPath,
        force: options.force,
      });
      console.log(
        `Extension identity rotated: ID ${rotated.extensionId}; key saved to ${displayPath(workspaceRoot, rotated.keyPath)}; updated manifest.json, crates/protocol/src/lib.rs, packages/protocol/src/index.ts, and scripts/check-artifacts.mjs.`,
      );
    } else {
      const built = await buildExtensionCrx({
        workspaceRoot,
        keyPath: options.keyPath,
        outPath: options.outPath,
        skipBuild: options.skipBuild,
      });
      console.log(
        `CRX3 extension package: PASS; ${displayPath(workspaceRoot, built.outPath)}; id=${built.extensionId}; version=${built.version}; ${built.entryCount} entries; ${built.bytes} bytes; SHA256 ${built.sha256}.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
