import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { access, mkdir, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { inspectNativeArtifact, inspectNativeFormat, nativePlatform, nativeReleaseContext, parseRustHost } from './native-build.mjs';
import { assertContainedProgram, assertExtractionRoot, bundleArguments, checkDebMetadata, createExtractionRoot, currentBundleFiles,
  debProgramMember, expectedBundleFile, inspectBundle, removeExtractionRoot, verifyPackagedProgram } from './native-package.mjs';

test('native artifact scanner rejects machine paths and secrets in ASCII and UTF-16', () => {
  for (const encoding of ['utf8', 'utf16le']) {
    for (const value of ['D:\\agent\\project\\source.rs', 'C:/Users/example/source.rs', '-----BEGIN PRIVATE KEY-----', `sk-${'x'.repeat(24)}`]) {
      assert.throws(() => inspectNativeArtifact(Buffer.from(value, encoding)), /Native artifact contains/);
    }
    inspectNativeArtifact(Buffer.from('/workspace/crates/core/src/lib.rs\0/cargo-home/registry/src/dependency.rs', encoding));
  }
});

function executable(platform, type = 2) {
  const data = Buffer.alloc(128);
  if (platform === 'win32') {
    data.write('MZ'); data.writeUInt32LE(64, 0x3c); data.write('PE\0\0', 64); data.writeUInt16LE(0x8664, 68);
  } else if (platform === 'linux') {
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(data); data.writeUInt16LE(type, 16); data.writeUInt16LE(62, 18);
  } else {
    data.writeUInt32LE(0xfeedfacf); data.writeUInt32LE(0x0100000c, 4); data.writeUInt32LE(type, 12);
  }
  return data;
}

const config = { productName: 'Markbridge', version: '0.1.0', identifier: 'com.markbridge.desktop' };
const releaseFor = platform => ({ ...nativePlatform(platform, platform === 'darwin' ? 'arm64' : 'x64'), env: {} });

test('native formats require host architecture and an executable file type', () => {
  for (const [platform, arch] of [['win32', 'x64'], ['linux', 'x64'], ['darwin', 'arm64']]) {
    inspectNativeFormat(executable(platform), platform, arch);
    assert.throws(() => inspectNativeFormat(Buffer.alloc(128), platform, arch), /format\/architecture/);
    assert.throws(() => inspectNativeFormat(executable(platform).subarray(0, 16), platform, arch), /format\/architecture/);
  }
  inspectNativeFormat(executable('linux', 3), 'linux', 'x64');
  assert.throws(() => inspectNativeFormat(executable('linux', 1), 'linux', 'x64'), /format\/architecture/);
  assert.throws(() => inspectNativeFormat(executable('darwin', 6), 'darwin', 'arm64'), /format\/architecture/);
  const wrongElf = executable('linux'); wrongElf.writeUInt16LE(183, 18);
  assert.throws(() => inspectNativeFormat(wrongElf, 'linux', 'x64'), /format\/architecture/);
  const bigEndian = executable('linux'); bigEndian[5] = 2;
  assert.throws(() => inspectNativeFormat(bigEndian, 'linux', 'x64'), /format\/architecture/);
  const wrongMach = executable('darwin'); wrongMach.writeUInt32LE(0x01000007, 4);
  assert.throws(() => inspectNativeFormat(wrongMach, 'darwin', 'arm64'), /format\/architecture/);
  const wrongPe = executable('win32'); wrongPe.writeUInt16LE(0x14c, 68);
  assert.throws(() => inspectNativeFormat(wrongPe, 'win32', 'x64'), /format\/architecture/);
  for (const offset of [0, 127, 0xffffffff]) {
    const pe = executable('win32'); pe.writeUInt32LE(offset, 0x3c);
    assert.throws(() => inspectNativeFormat(pe, 'win32', 'x64'), /format\/architecture/);
  }
});

test('POSIX source/cache leaks fail without rejecting native system or virtual paths', () => {
  const prefix = '/opt/private-build-cache';
  for (const encoding of ['utf8', 'utf16le']) {
    for (const path of ['/Users/fixture/work/source.rs', '/home/fixture/.cargo/src/lib.rs', prefix + '/source.rs']) {
      assert.throws(() => inspectNativeArtifact(Buffer.from(path, encoding), { sourcePrefixes: [prefix] }), error =>
        error.message.includes('Native artifact contains') && !error.message.includes(path));
    }
    inspectNativeArtifact(Buffer.from('/usr/lib/libc.so\0/System/Library/Frameworks/WebKit.framework\0/workspace/src/main.rs\0/build-home/tool.rs\0/cargo-home/src/lib.rs', encoding), { sourcePrefixes: [prefix] });
  }
});

test('native targets pin output and bundle arguments independently of inherited cross-target settings', () => {
  for (const [platform, arch, target, bundles] of [['win32', 'x64', 'x86_64-pc-windows-msvc', ['nsis']],
    ['linux', 'x64', 'x86_64-unknown-linux-gnu', ['deb', 'appimage']], ['darwin', 'arm64', 'aarch64-apple-darwin', ['app', 'dmg']]]) {
    const windows = platform === 'win32', workspace = windows ? 'D:\\native\\work' : '/native/work', userHome = windows ? 'C:\\Users\\fixture' : '/home/fixture';
    const env = { CARGO_BUILD_TARGET: 'other-target', CARGO_TARGET_DIR: 'cache', CARGO_HOME: 'cargo', RUSTUP_HOME: 'rustup', RUSTFLAGS: '-C ignored', CARGO_ENCODED_RUSTFLAGS: '-C\x1fdebuginfo=0' };
    const release = nativeReleaseContext(workspace, { platform, arch, env, userHome });
    const path = windows ? (parts => parts.join('\\')) : (parts => parts.join('/'));
    assert.equal(release.targetDirectory, path([workspace, 'cache']));
    assert.equal(release.releaseDirectory, path([workspace, 'cache', target, 'release']));
    assert.equal(release.artifact, path([release.releaseDirectory, release.binaryName]));
    assert.equal(release.env.CARGO_TARGET_DIR, release.targetDirectory);
    assert.equal(release.env.CARGO_HOME, path([workspace, 'cargo']));
    assert.equal(release.env.RUSTUP_HOME, path([workspace, 'rustup']));
    assert.equal(env.CARGO_TARGET_DIR, 'cache');
    const flags = release.env.CARGO_ENCODED_RUSTFLAGS.split('\x1f');
    assert.deepEqual(flags.slice(0, 2), ['-C', 'debuginfo=0']);
    assert.ok(flags.includes('--remap-path-prefix=' + workspace + '=/workspace'));
    assert.ok(flags.includes('--remap-path-prefix=' + path([workspace, 'cache']) + '=/build-target'));
    assert.deepEqual(bundleArguments(release), [release.cli, 'bundle', '--target', target, '--bundles', bundles.join(','), '--no-sign', '--no-binary-patching', '--ci', '--config', JSON.stringify({ bundle: { active: true, targets: bundles } })]);
  }
  assert.throws(() => nativePlatform('darwin', 'x64'), /acceptance targets/);
  assert.throws(() => nativePlatform('linux', 'arm64'), /acceptance targets/);
  assert.throws(() => nativeReleaseContext('relative', { platform: 'linux', arch: 'x64', env: {}, userHome: '/home/fixture' }), /absolute/);
  const custom = nativeReleaseContext('/native/work', { platform: 'linux', arch: 'x64', env: { CARGO_TARGET_DIR: '/cache/native', RUSTFLAGS: '-C debuginfo=0' }, userHome: '/home/fixture' });
  assert.equal(custom.artifact, '/cache/native/x86_64-unknown-linux-gnu/release/markbridge-desktop');
  assert.deepEqual(custom.env.CARGO_ENCODED_RUSTFLAGS.split('\x1f').slice(0, 2), ['-C', 'debuginfo=0']);
});

test('Rust host parsing rejects missing, ambiguous and malformed metadata', () => {
  assert.equal(parseRustHost('rustc 1.99.0\nhost: x86_64-unknown-linux-gnu\nrelease: 1.99.0\n'), 'x86_64-unknown-linux-gnu');
  for (const output of ['', 'host: x86_64-unknown-linux-gnu\nhost: aarch64-apple-darwin', 'host: invalid host', 'host: x86_64-linux ']) assert.throws(() => parseRustHost(output));
});

test('packaged program byte mismatch and wrong format remain hard failures', () => {
  const release = releaseFor('linux'), bytes = executable('linux');
  assert.equal(verifyPackagedProgram(bytes, bytes, release).matchesPostBundleRelease, true);
  const changed = Buffer.from(bytes); changed[100] = 1;
  assert.throws(() => verifyPackagedProgram(changed, bytes, release), /does not match/);
  assert.throws(() => verifyPackagedProgram(executable('darwin'), bytes, release), /format\/architecture/);
});

function elfWith({ text, dynstr }) {
  const nameTable = Buffer.from('\0.text\0.dynstr\0.shstrtab\0');
  const textBytes = Buffer.from(text);
  const dynBytes = Buffer.from(dynstr);
  const shoff = 64 + textBytes.length + dynBytes.length + nameTable.length;
  const data = Buffer.alloc(shoff + 4 * 64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(data);
  data.writeUInt16LE(2, 16);
  data.writeUInt16LE(62, 18);
  data.writeBigUInt64LE(BigInt(shoff), 40);
  data.writeUInt16LE(64, 58);
  data.writeUInt16LE(4, 60);
  data.writeUInt16LE(3, 62);
  const textAt = 64;
  const dynAt = textAt + textBytes.length;
  const namesAt = dynAt + dynBytes.length;
  textBytes.copy(data, textAt);
  dynBytes.copy(data, dynAt);
  nameTable.copy(data, namesAt);
  const writeHeader = (index, nameOffset, type, offset, size) => {
    const at = shoff + index * 64;
    data.writeUInt32LE(nameOffset, at);
    data.writeUInt32LE(type, at + 4);
    data.writeBigUInt64LE(BigInt(offset), at + 24);
    data.writeBigUInt64LE(BigInt(size), at + 32);
  };
  writeHeader(1, 1, 1, textAt, textBytes.length);
  writeHeader(2, 7, 3, dynAt, dynBytes.length);
  writeHeader(3, 15, 3, namesAt, nameTable.length);
  return data;
}

test('AppImage may differ in loader metadata but not in program sections', () => {
  const release = releaseFor('linux');
  const original = elfWith({ text: 'HELLO', dynstr: '\0old\0' });
  const patched = elfWith({ text: 'HELLO', dynstr: '\0new-rpath-value\0' });
  const rewritten = elfWith({ text: 'WORLD', dynstr: '\0old\0' });
  assert.equal(verifyPackagedProgram(original, original, release, 'appimage').matchesPostBundleRelease, true);
  assert.equal(verifyPackagedProgram(patched, original, release, 'appimage').matchesPostBundleRelease, false);
  assert.throws(() => verifyPackagedProgram(rewritten, original, release, 'appimage'), /section \.text/);
  assert.throws(() => verifyPackagedProgram(patched, original, release, 'deb'), /does not match/);
  assert.throws(() => verifyPackagedProgram(executable('linux'), original, release, 'appimage'), /no section table/);
});

test('Debian selectors reject missing/duplicate program and metadata mismatches', () => {
  assert.equal(debProgramMember('./usr/bin/markbridge-desktop\n./usr/share/data\n', 'markbridge-desktop'), './usr/bin/markbridge-desktop');
  for (const listing of ['../usr/bin/markbridge-desktop', './usr/bin/other', './usr/bin/markbridge-desktop\nusr/bin/markbridge-desktop']) assert.throws(() => debProgramMember(listing, 'markbridge-desktop'));
  checkDebMetadata('Architecture: amd64\nVersion: 0.1.0\n', '0.1.0');
  for (const metadata of ['Version: 0.1.0\nArchitecture: arm64', 'Version: 0.0.9\nArchitecture: amd64', 'Version: 0.1.0\nArchitecture: amd64\nextra', '0.1.0\namd64']) assert.throws(() => checkDebMetadata(metadata, '0.1.0'));
});

test('owned extraction cleanup does not traverse a child junction or accept redirected roots', async () => {
  const owned = await createExtractionRoot(), outside = await createExtractionRoot();
  const sentinel = join(outside, 'sentinel'); await writeFile(sentinel, 'preserve');
  try {
    await symlink(outside, join(owned, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(assertContainedProgram(owned, join(owned, 'escape/sentinel')), /contains a link/);
    await assert.rejects(assertContainedProgram(owned, sentinel), /escapes/);
    await removeExtractionRoot(owned);
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve');
    const redirected = await createExtractionRoot(), moved = redirected + '-moved';
    await rename(redirected, moved);
    await symlink(outside, redirected, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      await assert.rejects(removeExtractionRoot(redirected), /redirected/);
      assert.equal(await readFile(sentinel, 'utf8'), 'preserve');
    } finally {
      await unlink(redirected); await rename(moved, redirected); await removeExtractionRoot(redirected);
    }
    await assert.rejects(removeExtractionRoot(outside + '-unknown'), /not owned/);
  } finally {
    await removeExtractionRoot(outside);
  }
});

test('extraction ownership marker tampering prevents cleanup', async () => {
  const directory = await createExtractionRoot(), marker = join(directory, '.markbridge-package-root'), original = await readFile(marker);
  try {
    await writeFile(marker, 'replacement');
    await assert.rejects(assertExtractionRoot(directory), /marker changed/);
  } finally { await writeFile(marker, original); await removeExtractionRoot(directory); }
});

test('Debian inspection reads one regular program to memory without filesystem archive extraction', async () => {
  const owner = await createExtractionRoot(), bundle = join(owner, 'package.deb'), bytes = executable('linux'), calls = [];
  await writeFile(bundle, 'fixture');
  const command = (tool, args, options) => {
    calls.push({ tool, args, options });
    if (args[0] === '--field') return 'Version: 0.1.0\nArchitecture: amd64\n';
    if (args[0] === '--fsys-tarfile') return Buffer.from('archive');
    if (args[0] === '-tf') return './usr/bin/markbridge-desktop\n';
    if (args[0] === '-tvf') return '-rwxr-xr-x root/root 128 date ./usr/bin/markbridge-desktop\n';
    if (args[0] === '-xOf') return bytes;
    throw new Error('Unexpected fixture command');
  };
  try {
    assert.equal((await inspectBundle('deb', bundle, bytes, releaseFor('linux'), config, command)).matchesPostBundleRelease, true);
    assert.ok(calls.every(call => !call.args.includes('--extract') && !call.args.includes('--raw-extract')));
    assert.equal(calls.at(-1).options.encoding, 'buffer');
    await assert.rejects(inspectBundle('deb', bundle, bytes, releaseFor('linux'), config,
      (tool, args, options) => args[0] === '-tvf' ? 'lrwxrwxrwx root/root 0 date path -> elsewhere' : command(tool, args, options)), /not a regular member/);
  } finally { await removeExtractionRoot(owner); }
});

function mockMacMetadata(tool, args) {
  assert.equal(tool, '/usr/bin/plutil');
  assert.deepEqual(args.slice(0, 1), ['-extract']);
  return { CFBundleExecutable: 'markbridge-desktop', CFBundleIdentifier: config.identifier, CFBundleShortVersionString: config.version, LSMinimumSystemVersion: '14.0' }[args[1]];
}

function createMacApp(directory, bytes) {
  mkdirSync(join(directory, 'Contents/MacOS'), { recursive: true });
  writeFileSync(join(directory, 'Contents/MacOS/markbridge-desktop'), bytes);
  writeFileSync(join(directory, 'Contents/Info.plist'), 'fixture');
}

test('Mac app inspection validates actual arm64 executable and configured plist values', async () => {
  const owner = await createExtractionRoot(), app = join(owner, 'Markbridge.app'), bytes = executable('darwin');
  createMacApp(app, bytes);
  try {
    assert.equal((await inspectBundle('app', app, bytes, releaseFor('darwin'), config, mockMacMetadata)).matchesPostBundleRelease, true);
    await assert.rejects(inspectBundle('app', app, bytes, releaseFor('darwin'), config,
      (tool, args) => args[1] === 'LSMinimumSystemVersion' ? '13.0' : mockMacMetadata(tool, args)), /metadata/);
  } finally { await removeExtractionRoot(owner); }
});

test('DMG detach failure preserves owned extraction root instead of recursively deleting a mounted volume', async () => {
  const owner = await createExtractionRoot(), dmg = join(owner, 'package.dmg'), bytes = executable('darwin');
  await writeFile(dmg, 'fixture');
  let volume;
  const command = (tool, args) => {
    if (tool === '/usr/bin/hdiutil' && args[0] === 'attach') {
      volume = args[args.indexOf('-mountpoint') + 1]; createMacApp(join(volume, 'Markbridge.app'), bytes); return '';
    }
    if (tool === '/usr/bin/hdiutil') throw new Error('Fixture detach failed');
    return mockMacMetadata(tool, args);
  };
  try {
    await assert.rejects(inspectBundle('dmg', dmg, bytes, releaseFor('darwin'), config, command), /detach failed/);
    await assertExtractionRoot(dirname(volume));
    assert.deepEqual(await readFile(join(volume, 'Markbridge.app/Contents/MacOS/markbridge-desktop')), bytes);
  } finally {
    if (volume) await removeExtractionRoot(dirname(volume)); // The mocked volume was never mounted.
    await removeExtractionRoot(owner);
  }
});

test('AppImage inspection uses only type-2 extraction and scans actual contained program', async () => {
  const owner = await createExtractionRoot(), bundle = join(owner, 'package.AppImage'), bytes = executable('linux'), container = executable('linux');
  Buffer.from([0x41, 0x49, 2]).copy(container, 8); await writeFile(bundle, container);
  let observed;
  const command = (tool, args, options) => {
    observed = options.cwd;
    assert.equal(tool, bundle); assert.deepEqual(args, ['--appimage-extract']);
    assert.equal(options.env.APPIMAGE_EXTRACT_AND_RUN, undefined);
    mkdirSync(join(options.cwd, 'squashfs-root/usr/bin'), { recursive: true });
    writeFileSync(join(options.cwd, 'squashfs-root/usr/bin/markbridge-desktop'), bytes); return '';
  };
  try {
    const release = { ...releaseFor('linux'), env: { APPIMAGE_EXTRACT_AND_RUN: '1' } };
    assert.equal((await inspectBundle('appimage', bundle, bytes, release, config, command)).matchesPostBundleRelease, true);
    await assert.rejects(access(observed), { code: 'ENOENT' });
    assert.equal(release.env.APPIMAGE_EXTRACT_AND_RUN, '1');
    container[10] = 1; await writeFile(bundle, container);
    await assert.rejects(inspectBundle('appimage', bundle, bytes, release, config, command), /not a type-2/);
  } finally { await removeExtractionRoot(owner); }
});

test('bundle selection ignores other versions but rejects missing/ambiguous current artifacts', async () => {
  const owner = await createExtractionRoot(), release = { ...releaseFor('linux'), releaseDirectory: owner };
  for (const kind of release.bundles) await mkdir(join(owner, 'bundle', kind), { recursive: true });
  const deb = join(owner, 'bundle/deb/Markbridge_0.1.0_amd64.deb'), appimage = join(owner, 'bundle/appimage/Markbridge_0.1.0_amd64.AppImage');
  try {
    await writeFile(join(owner, 'bundle/deb/Markbridge_0.0.9_amd64.deb'), 'old');
    await assert.rejects(currentBundleFiles(release, config), /absent or ambiguous/);
    await writeFile(deb, 'fixture'); await writeFile(appimage, 'fixture');
    assert.deepEqual((await currentBundleFiles(release, config)).map(entry => entry.path), [deb, appimage]);
    await writeFile(join(owner, 'bundle/deb/Markbridge_0.1.0_arm64.deb'), 'other-target');
    await assert.rejects(currentBundleFiles(release, config), /absent or ambiguous/);
  } finally { await removeExtractionRoot(owner); }
});

test('locked bundle filename contracts preserve product casing and exact target architecture', async () => {
  assert.equal(expectedBundleFile('deb', config), 'Markbridge_0.1.0_amd64.deb');
  assert.equal(expectedBundleFile('appimage', config), 'Markbridge_0.1.0_amd64.AppImage');
  assert.equal(expectedBundleFile('nsis', config), 'Markbridge_0.1.0_x64-setup.exe');
  assert.equal(expectedBundleFile('dmg', config), 'Markbridge_0.1.0_aarch64.dmg');
  assert.equal(expectedBundleFile('app', config), 'Markbridge.app');
  const owner = await createExtractionRoot(), directory = join(owner, 'bundle/deb');
  await mkdir(directory, { recursive: true });
  const release = { ...releaseFor('linux'), releaseDirectory: owner, bundles: ['deb'] };
  try {
    const lowercase = join(directory, 'markbridge_0.1.0_amd64.deb');
    await writeFile(lowercase, 'fixture');
    await assert.rejects(currentBundleFiles(release, config), /absent or ambiguous/);
    await unlink(lowercase);
    const wrongArch = join(directory, 'Markbridge_0.1.0_arm64.deb');
    await writeFile(wrongArch, 'fixture');
    await assert.rejects(currentBundleFiles(release, config), /selected host architecture/);
    await unlink(wrongArch);
    const expected = join(directory, 'Markbridge_0.1.0_amd64.deb');
    await writeFile(expected, 'fixture');
    assert.deepEqual(await currentBundleFiles(release, config), [{ kind: 'deb', path: expected }]);
  } finally { await removeExtractionRoot(owner); }
});
