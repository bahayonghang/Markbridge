import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectNativeArtifact, inspectNativeFormat, nativeReleaseContext } from './native-build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const extractionRoots = new Map();
const markerName = '.markbridge-package-root';
const sha256 = data => createHash('sha256').update(data).digest('hex');

function runTool(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Native package inspection tool failed.');
  return result.stdout;
}

export function bundleArguments(release) {
  return [release.cli, 'bundle', '--target', release.target, '--bundles', release.bundles.join(','),
    '--no-sign', '--no-binary-patching', '--ci', '--config',
    JSON.stringify({ bundle: { active: true, targets: release.bundles } })];
}

export async function createExtractionRoot() {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, 'markbridge-package-'));
  const marker = randomUUID();
  await writeFile(join(directory, markerName), marker, { flag: 'wx' });
  extractionRoots.set(directory, { parent, marker });
  return directory;
}

export async function assertExtractionRoot(directory) {
  const ownership = extractionRoots.get(directory);
  assert.ok(isAbsolute(directory) && ownership && dirname(directory) === ownership.parent && /^markbridge-package-[A-Za-z0-9]+$/.test(basename(directory)), 'Package extraction root is not owned.');
  const stat = await lstat(directory), marker = join(directory, markerName);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(directory) === directory, 'Package extraction root was redirected.');
  assert.ok(!(await lstat(marker)).isSymbolicLink() && await readFile(marker, 'utf8') === ownership.marker, 'Package extraction ownership marker changed.');
}

export async function removeExtractionRoot(directory) {
  await assertExtractionRoot(directory);
  // fs.rm removes child symlinks/junctions themselves; it does not traverse their targets.
  await rm(directory, { recursive: true, force: false });
  extractionRoots.delete(directory);
}

export async function assertContainedProgram(container, program) {
  const containerStat = await lstat(container);
  assert.ok(containerStat.isDirectory() && !containerStat.isSymbolicLink(), 'Package program container is redirected.');
  const suffix = relative(container, program);
  assert.ok(suffix && !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep), 'Package program escapes its container.');
  let current = container;
  for (const part of suffix.split(sep)) {
    current = join(current, part);
    assert.ok(!(await lstat(current)).isSymbolicLink(), 'Package program path contains a link.');
  }
  assert.ok((await lstat(program)).isFile() && await realpath(program) === join(await realpath(container), suffix), 'Package program is not a contained regular file.');
}

const loaderSection = name => name === '.interp' || name === '.dynamic' || name === '.dynstr' || name === '.dynsym'
  || name === '.gnu.hash' || name === '.hash' || name === '.comment' || name === '.shstrtab'
  || name.startsWith('.gnu.version') || name.startsWith('.rela.') || name.startsWith('.rel.') || name.startsWith('.note');

function readElfOffset(data, at) {
  const value = data.readBigUInt64LE(at);
  assert.ok(value <= BigInt(Number.MAX_SAFE_INTEGER), 'AppImage program offset is too large.');
  return Number(value);
}

function elfProgramSections(data) {
  assert.ok(data.length >= 64 && data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && data[4] === 2 && data[5] === 1, 'AppImage program is not an ELF64 image.');
  const shoff = readElfOffset(data, 40);
  const shentsize = data.readUInt16LE(58);
  const shnum = data.readUInt16LE(60);
  const shstrndx = data.readUInt16LE(62);
  assert.ok(shoff > 0 && shnum > 0 && shentsize >= 64 && shstrndx < shnum, 'AppImage program has no section table to compare.');
  const tableEnd = shoff + shnum * shentsize;
  assert.ok(tableEnd <= data.length, 'AppImage program section table is out of range.');
  const header = index => {
    const at = shoff + index * shentsize;
    return {
      nameOffset: data.readUInt32LE(at),
      type: data.readUInt32LE(at + 4),
      offset: readElfOffset(data, at + 24),
      size: readElfOffset(data, at + 32),
    };
  };
  const namesHeader = header(shstrndx);
  assert.ok(namesHeader.offset + namesHeader.size <= data.length, 'AppImage program section names are out of range.');
  const names = data.subarray(namesHeader.offset, namesHeader.offset + namesHeader.size);
  const sectionName = offset => {
    assert.ok(offset < names.length, 'AppImage program section name is out of range.');
    const end = names.indexOf(0, offset);
    assert.ok(end >= 0, 'AppImage program section name is not terminated.');
    return names.toString('utf8', offset, end);
  };
  const sections = new Map();
  for (let index = 0; index < shnum; index += 1) {
    const item = header(index);
    if (item.type !== 1) continue;
    const name = sectionName(item.nameOffset);
    if (loaderSection(name)) continue;
    assert.ok(!sections.has(name), 'AppImage program section name is ambiguous.');
    assert.ok(item.offset + item.size <= data.length, 'AppImage program section is out of range.');
    sections.set(name, data.subarray(item.offset, item.offset + item.size));
  }
  assert.ok(sections.get('.text')?.length > 0, 'AppImage program has no .text section.');
  return sections;
}

export function mismatchedAppImageSection(packaged, releaseBytes) {
  const left = elfProgramSections(packaged);
  const right = elfProgramSections(releaseBytes);
  const names = [...new Set([...left.keys(), ...right.keys()])].sort();
  return names.find(name => {
    const actual = left.get(name);
    const expected = right.get(name);
    return actual === undefined || expected === undefined || !actual.equals(expected);
  }) ?? null;
}

export function verifyPackagedProgram(data, releaseBytes, release, kind) {
  inspectNativeArtifact(data, release);
  if (data.equals(releaseBytes)) return { bytes: data.length, sha256: sha256(data), matchesPostBundleRelease: true };
  if (kind === 'appimage') {
    const section = mismatchedAppImageSection(data, releaseBytes);
    assert.equal(section, null, `AppImage program section ${section ?? ''} does not match the post-bundle release executable.`);
    return { bytes: data.length, sha256: sha256(data), matchesPostBundleRelease: false };
  }
  assert.fail('Packaged executable does not match the post-bundle release executable.');
}

export function debProgramMember(listing, binaryName) {
  const members = listing.split(/\r?\n/).filter(name => name === 'usr/bin/' + binaryName || name === './usr/bin/' + binaryName);
  assert.equal(members.length, 1, 'Debian package program member is absent or ambiguous.');
  return members[0];
}

export function checkDebMetadata(output, version) {
  assert.deepEqual(output.trim().split(/\r?\n/).sort(), ['Version: ' + version, 'Architecture: amd64'].sort(), 'Debian package version/architecture does not match the native target.');
}

async function resolveSevenZip() {
  for (const command of ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe', '7z']) {
    if (isAbsolute(command)) {
      try { await access(command); } catch { continue; }
    }
    const probe = spawnSync(command, ['i'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 });
    if (!probe.error && probe.status === 0) return command;
  }
  throw new Error('Packaged executable scan is NOT_RUN: 7-Zip is required.');
}

async function inspectMacApp(directory, releaseBytes, release, config, command) {
  const program = join(directory, 'Contents/MacOS', release.binaryName), plist = join(directory, 'Contents/Info.plist');
  await assertContainedProgram(directory, program);
  await assertContainedProgram(directory, plist);
  for (const [key, expected] of [['CFBundleExecutable', release.binaryName], ['CFBundleIdentifier', config.identifier],
    ['CFBundleShortVersionString', config.version], ['LSMinimumSystemVersion', '14.0']]) {
    assert.equal(command('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]).trim(), expected, 'macOS bundle metadata does not match the configured native target.');
  }
  return verifyPackagedProgram(await readFile(program), releaseBytes, release, 'app');
}

export async function inspectBundle(kind, bundle, releaseBytes, release, config, command = runTool) {
  if (kind === 'app') return inspectMacApp(bundle, releaseBytes, release, config, command);
  await assertContainedProgram(dirname(bundle), bundle);
  const directory = await createExtractionRoot();
  let mountAttempted = false, detached = kind !== 'dmg';
  try {
    let program;
    if (kind === 'dmg') {
      const volume = join(directory, 'volume');
      await mkdir(volume);
      mountAttempted = true;
      command('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', volume, bundle]);
      return await inspectMacApp(join(volume, config.productName + '.app'), releaseBytes, release, config, command);
    } else if (kind === 'nsis') {
      const sevenZip = await resolveSevenZip();
      command(sevenZip, ['l', bundle]);
      command(sevenZip, ['e', bundle, '-o' + directory, release.binaryName, '-y']);
      program = join(directory, release.binaryName);
    } else if (kind === 'deb') {
      checkDebMetadata(command('dpkg-deb', ['--field', bundle, 'Version', 'Architecture']), config.version);
      const archive = command('dpkg-deb', ['--fsys-tarfile', bundle], { encoding: 'buffer' });
      const member = debProgramMember(command('tar', ['-tf', '-'], { input: archive }), release.binaryName);
      const detail = command('tar', ['-tvf', '-', '--', member], { input: archive }).trim().split(/\r?\n/);
      assert.ok(detail.length === 1 && detail[0].startsWith('-'), 'Debian package program is not a regular member.');
      program = join(directory, release.binaryName);
      await writeFile(program, command('tar', ['-xOf', '-', '--', member], { input: archive, encoding: 'buffer' }), { flag: 'wx' });
    } else {
      assert.equal(kind, 'appimage', 'Unexpected native bundle format.');
      const container = await readFile(bundle);
      inspectNativeFormat(container, release.platform, release.arch);
      assert.ok(container.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 2])), 'AppImage is not a type-2 extraction runtime.');
      const env = { ...release.env };
      delete env.APPIMAGE_EXTRACT_AND_RUN;
      command(bundle, ['--appimage-extract'], { cwd: directory, env });
      program = join(directory, 'squashfs-root/usr/bin', release.binaryName);
    }
    await assertExtractionRoot(directory);
    await assertContainedProgram(directory, program);
    return verifyPackagedProgram(await readFile(program), releaseBytes, release, kind);
  } finally {
    if (mountAttempted) {
      // Never recursively remove a mounted volume. Failed detach preserves this owned temporary root.
      command('/usr/bin/hdiutil', ['detach', join(directory, 'volume')]);
      detached = true;
    }
    if (detached) await removeExtractionRoot(directory);
  }
}

export function expectedBundleFile(kind, config) {
  // Locked Tauri CLI 2.12.2 uses productName verbatim for these filenames.
  const base = config.productName + '_' + config.version;
  const names = { app: config.productName + '.app', nsis: base + '_x64-setup.exe',
    dmg: base + '_aarch64.dmg', deb: base + '_amd64.deb', appimage: base + '_amd64.AppImage' };
  assert.ok(names[kind], 'Unexpected native bundle format.');
  return names[kind];
}

export async function currentBundleFiles(release, config) {
  const result = [];
  for (const kind of release.bundles) {
    const directory = join(release.releaseDirectory, 'bundle', kind === 'app' ? 'macos' : kind);
    const suffix = { nsis: '.exe', dmg: '.dmg', deb: '.deb', appimage: '.AppImage' }[kind];
    const names = (await readdir(directory)).filter(name => kind === 'app'
      ? name === config.productName + '.app'
      : name.startsWith(config.productName + '_' + config.version + '_') && name.endsWith(suffix));
    assert.equal(names.length, 1, 'Current native bundle is absent or ambiguous; stale artifacts cannot substitute.');
    assert.equal(names[0], expectedBundleFile(kind, config), 'Current native bundle filename does not match the selected host architecture.');
    result.push({ kind, path: join(directory, names[0]) });
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const release = nativeReleaseContext(root);
  const built = spawnSync(process.execPath, [fileURLToPath(new URL('./native-build.mjs', import.meta.url))], {
    cwd: root, env: release.env, stdio: 'inherit',
  });
  if (built.error) throw built.error;
  if (built.status !== 0) process.exit(built.status ?? 1);
  const bundle = spawnSync(process.execPath, bundleArguments(release), {
    cwd: resolve(root, 'apps/desktop'), env: release.env, stdio: 'inherit',
  });
  if (bundle.error) throw bundle.error;
  if (bundle.status !== 0) process.exit(bundle.status ?? 1);
  const releaseBytes = await readFile(release.artifact);
  inspectNativeArtifact(releaseBytes, release);
  console.log('Post-bundle release executable: PASS; ' + releaseBytes.length + ' bytes; SHA256 ' + sha256(releaseBytes) + '.');
  const config = JSON.parse(await readFile(resolve(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  assert.ok(config.productName && !/[\\/\0]/.test(config.productName), 'Bundle product name is not a file component.');
  for (const entry of await currentBundleFiles(release, config)) {
    const result = await inspectBundle(entry.kind, entry.path, releaseBytes, release, config);
    const relation = result.matchesPostBundleRelease
      ? 'matches post-bundle release'
      : 'program sections match post-bundle release; dynamic loader metadata differs';
    console.log('Packaged executable (' + entry.kind + '): PASS; ' + result.bytes + ' bytes; SHA256 ' + result.sha256 + '; ' + relation + '; unsigned; unpublished.');
  }
}
