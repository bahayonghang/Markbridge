import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const root = process.argv[2];
if (!root || !isAbsolute(root)) {
  process.stderr.write('MB05_B10K needs an absolute directory\n');
  process.exit(2);
}

const { buildB10k, localStateFile } = await import(new URL('./b10k.ts', import.meta.url));
const built = buildB10k();
await mkdir(join(root, 'Default'), { recursive: true });
await writeFile(join(root, 'Local State'), JSON.stringify(localStateFile()));
await writeFile(join(root, 'Default', 'Bookmarks'), JSON.stringify(built.chromeFile));
process.stdout.write(`MB05_B10K bookmarks=${built.bookmarks} folders=${built.folders} depth=${built.maxDepth}\n`);
