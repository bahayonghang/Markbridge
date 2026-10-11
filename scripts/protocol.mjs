import { spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compile } from 'json-schema-to-typescript';

// Ajv is declared by the protocol package, which owns the runtime contract.
const requireProtocol = createRequire(new URL('../packages/protocol/package.json', import.meta.url));
const Ajv2020 = requireProtocol('ajv/dist/2020.js').default;
const standaloneCode = requireProtocol('ajv/dist/standalone/index.js').default;
const { _ } = requireProtocol('ajv/dist/compile/codegen/index.js');
const formatsCode = _`({uint8:{type:"number",validate:value=>Number.isInteger(value)&&value>=0&&value<=255},uint16:{type:"number",validate:value=>Number.isInteger(value)&&value>=0&&value<=65535},uint64:{type:"number",validate:value=>Number.isSafeInteger(value)&&value>=0}})`;

function standaloneValidator(schema) {
  const ajv = new Ajv2020({ strict: true, allErrors: false, code: { source: true, esm: true, formats: formatsCode } });
  for (const [name, maximum] of [['uint8', 255], ['uint16', 65535], ['uint64', Number.MAX_SAFE_INTEGER]]) {
    ajv.addFormat(name, { type: 'number', validate: value => Number.isSafeInteger(value) && value >= 0 && value <= maximum });
  }
  let source = standaloneCode(ajv, ajv.compile(schema));
  const imports = new Map();
  source = source.replace(/require\("ajv\/dist\/runtime\/([a-zA-Z0-9_-]+)"\)\.default/g, (_match, module) => {
    const name = `runtime_${module.replaceAll('-', '_')}`;
    imports.set(name, `import * as ${name}_module from 'ajv/dist/runtime/${module}.js';\nconst ${name} = ${name}_module.default.default ?? ${name}_module.default;`);
    return name;
  });
  if (/\brequire\s*\(|\bFunction\s*\(|\beval\s*\(/.test(source)) throw new Error('Standalone validator contains unsupported runtime code');
  return `/* Generated from crates/protocol with Ajv standalone. Run pnpm protocol:generate. */\n${[...imports.values()].join('\n')}\n${source}\n`;
}

const root = fileURLToPath(new URL('../', import.meta.url));
export const generatedDir = new URL('../packages/protocol/src/generated/', import.meta.url);

export async function generateProtocol() {
  const outputs = new Map();
  for (const [name, title, argument] of [['startup-state', 'StartupState', 'startup'], ['wire-message', 'WireMessage', 'wire'], ['bridge-state', 'BridgeState', 'bridge'], ['pairing-offer', 'PairingOffer', 'pairing'], ['mirror-tree', 'MirrorTree', 'mirror-tree'], ['chrome-profiles', 'ChromeProfileList', 'chrome-profiles'], ['library-nodes', 'LibraryNodes', 'library-nodes'], ['library-page', 'LibraryPage', 'library-page'], ['library-search', 'LibrarySearch', 'library-search'], ['library-detail', 'LibraryDetail', 'library-detail'], ['library-count', 'LibraryCount', 'library-count'], ['edit-preview', 'EditPreview', 'edit-preview'], ['apply-result', 'ApplyResult', 'apply-result'], ['operation-list', 'OperationList', 'operation-list'], ['edit-document', 'EditDocument', 'edit-document']]) {
    const result = spawnSync('cargo', ['run', '--quiet', '--locked', '-p', 'markbridge-protocol', '--bin', 'export-schema', '--', argument], {
      cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Schema exporter failed: ${result.error?.message ?? result.stderr}`);
    }
    const schema = JSON.parse(result.stdout);
    const types = await compile(schema, title, {
      bannerComment: '/* Generated from crates/protocol. Run pnpm protocol:generate. */',
      additionalProperties: false,
      maxItems: 0,
      style: { singleQuote: true },
    });
    outputs.set(`${name}.schema.json`, `${JSON.stringify(schema, null, 2)}\n`);
    outputs.set(`${name}.d.ts`, types);
    outputs.set(`${name}.validator.js`, standaloneValidator(schema));
    outputs.set(`${name}.validator.d.ts`, `/* Generated from crates/protocol. Run pnpm protocol:generate. */\nimport type { ${title} } from './${name}';\nexport default function validate(value: unknown): value is ${title};\n`);
  }
  return outputs;
}

export async function checkProtocol(directory = generatedDir) {
  const outputs = await generateProtocol();
  const drift = [];
  for (const [name, expected] of outputs) {
    const actual = await readFile(new URL(name, directory), 'utf8').catch(() => null);
    if (actual !== expected) drift.push(name);
  }
  if (drift.length) throw new Error(`Protocol drift: ${drift.join(', ')}. Run pnpm protocol:generate.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const outputs = await generateProtocol();
    await mkdir(generatedDir, { recursive: true });
    for (const [name, content] of outputs) await writeFile(new URL(name, generatedDir), content);
    console.log('Generated protocol schema, TypeScript and CSP-safe standalone validators.');
  } else if (process.argv[2] === '--check') {
    await checkProtocol();
    console.log('Protocol generation matches tracked outputs.');
  } else {
    throw new Error('Usage: node scripts/protocol.mjs --write|--check');
  }
}
