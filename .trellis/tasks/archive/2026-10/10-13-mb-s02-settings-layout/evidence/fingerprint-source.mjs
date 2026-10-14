import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

let repo=resolve(import.meta.dirname);
while(!existsSync(join(repo,'pnpm-workspace.yaml'))){
  const parent=resolve(repo,'..'); if(parent===repo)throw new Error('WORKSPACE_ROOT_NOT_FOUND'); repo=parent;
}
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','--','apps','crates','packages','scripts','assets','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','justfile','tsconfig.base.json','tsconfig.tools.json','vitest.config.ts','playwright.config.ts','eslint.config.js'],{cwd:repo,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean).sort();
const files=[];const fingerprint=createHash('sha256'),production=createHash('sha256');let productionFiles=0;
for(const path of paths){
  const data=await readFile(join(repo,path));const sha256=createHash('sha256').update(data).digest('hex');
  files.push({path,bytes:data.length,sha256});fingerprint.update(`${path}\0${sha256}\n`);
  if(!path.startsWith('tests/')&&!/\.test\.(?:[cm]?js|tsx?)$/.test(path)){production.update(`${path}\0${sha256}\n`);productionFiles+=1;}
}
const result={createdAt:new Date().toISOString(),fingerprint:fingerprint.digest('hex'),productionFingerprint:production.digest('hex'),productionFiles,files};
await writeFile(join(import.meta.dirname,'current-source.json'),`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify({fingerprint:result.fingerprint,productionFingerprint:result.productionFingerprint,productionFiles,files:files.length}));
