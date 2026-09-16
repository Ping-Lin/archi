#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const args=process.argv.slice(2),i=args.indexOf('--root');
if(i>=0&&!args[i+1])throw new Error('--root requires a path');
const root=path.resolve(i<0?process.cwd():args[i+1]);
function run(command,arguments_){const r=spawnSync(command,arguments_,{cwd:root,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);}
for(const command of ['validate','generate','check'])run(process.execPath,['scripts/archi.mjs',command,'--root',root]);
run(process.platform==='win32'?'npm.cmd':'npm',['test']);
const helm=spawnSync('helm',['version','--short'],{stdio:'ignore'});
if(helm.status===0)run(process.execPath,['scripts/archi.mjs','helm','--root',root]);
else if(args.includes('--require-helm')){console.error('Required Helm gate unavailable');process.exit(1);}
else console.warn('INCOMPLETE: Helm lint/render not run. Install Helm 3 and run npm run check:helm.');
