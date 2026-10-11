import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { checkProtocol, generateProtocol } from './protocol.mjs';

test('drift gate rejects changed TypeScript and schema, without touching tracked outputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'markbridge-protocol-'));
  const directoryUrl = pathToFileURL(`${directory}/`);
  try {
    const outputs = await generateProtocol();
    for (const [name, content] of outputs) await writeFile(join(directory, name), content);
    await checkProtocol(directoryUrl);
    const types = 'startup-state.d.ts';
    await writeFile(join(directory, types), `${outputs.get(types)}\nexport type Drift = true;\n`);
    await assert.rejects(checkProtocol(directoryUrl), /Protocol drift: startup-state.d.ts/);
    await writeFile(join(directory, types), outputs.get(types));
    await writeFile(join(directory, 'startup-state.schema.json'), '{}\n');
    await assert.rejects(checkProtocol(directoryUrl), /Protocol drift: startup-state.schema.json/);
    await writeFile(join(directory, 'startup-state.schema.json'), outputs.get('startup-state.schema.json'));
    await writeFile(join(directory, 'wire-message.validator.js'), `${outputs.get('wire-message.validator.js')}\n// drift\n`);
    await assert.rejects(checkProtocol(directoryUrl), /Protocol drift: wire-message.validator.js/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('generated validators run with string code generation disabled, as required by MV3 CSP', () => {
  const generated = new URL('../packages/protocol/src/generated/', import.meta.url);
  const source = `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import startup from ${JSON.stringify(new URL('startup-state.validator.js', generated).href)};
    import wire from ${JSON.stringify(new URL('wire-message.validator.js', generated).href)};
    import bridge from ${JSON.stringify(new URL('bridge-state.validator.js', generated).href)};
    import pairing from ${JSON.stringify(new URL('pairing-offer.validator.js', generated).href)};
    import mirrorTree from ${JSON.stringify(new URL('mirror-tree.validator.js', generated).href)};
    import chromeProfiles from ${JSON.stringify(new URL('chrome-profiles.validator.js', generated).href)};
    try {
    assert.throws(() => Function('return 1'), /Code generation from strings disallowed/);
    assert.equal(startup({protocolVersion:1,state:'unpaired'}), true);
    assert.equal(startup({protocolVersion:2,state:'unpaired'}), false);
    const fixture = JSON.parse(readFileSync(new URL(${JSON.stringify(new URL('../tests/fixtures/protocol/rust-to-ts.json', import.meta.url).href)}), 'utf8'));
    assert.equal(wire(fixture), true);
    assert.equal(wire({...fixture, protocolVersion:2}), false);
    assert.equal(bridge({protocolVersion:1,revision:0,port:49153,errorCode:null,profiles:[],pending:[],mirrors:[]}), true);
    assert.equal(bridge({protocolVersion:1,revision:0,port:49153,errorCode:null,profiles:[],pending:[]}), false);
    assert.equal(bridge({protocolVersion:1,revision:0.5,port:49153,errorCode:null,profiles:[],pending:[],mirrors:[]}), false);
    const mirror = {mirrorSourceId:'mirror-a',displayName:'Personal',fileStatus:'stale',association:'independent',revision:1,lastSyncedAt:null,errorCode:null,canWriteBrowser:false,nodes:[]};
    assert.equal(mirrorTree(mirror), true);
    assert.equal(mirrorTree({...mirror, canWriteBrowser:true}), false);
    assert.equal(chromeProfiles({profiles:[{directoryKey:'Default',displayName:'Personal',bookmarksPresent:true}]}), true);
    assert.equal(chromeProfiles({profiles:[{directoryKey:'Default',displayName:'Personal'}]}), false);
    assert.equal(pairing({profileId:'profile-test',pairingCode:'fixture',expiresAt:1}), true);
    assert.equal(pairing({profileId:'profile-test',pairingCode:'fixture',expiresAt:-1}), false);
    } catch (error) { console.error(error.name + ': ' + error.message); process.exit(1); }
  `;
  const result = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '--eval', source], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
