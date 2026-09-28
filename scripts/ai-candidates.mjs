import path from 'node:path';
import { captureSystem } from '../src/analysis/repositories.mjs';
import { verifyAiBundle, candidateHash } from '../src/analysis/ai-candidates.mjs';
import { readJson } from '../src/observations/file.mjs';
import { createJson } from '../src/observations/create.mjs';
import { reviewQueue, applyCandidateReview } from '../src/analysis/ai-review.mjs';
try {
  const [command,...args]=process.argv.slice(2), options={};
  if(!['template','check','queue','review'].includes(command)||args.length%2)throw Error('Usage: node scripts/ai-candidates.mjs template|check|queue|review --root ROOT --system MANIFEST --service ID [command options; see docs/ai-candidates.md]');
  const common=['--root','--system','--service'];
  const allowed=[...common,...({template:['--out'],check:['--bundle'],queue:[],review:['--candidate','--hash','--environment','--instance','--decision','--reviewer','--reason','--out']}[command])];
  for(let i=0;i<args.length;i+=2){if(!allowed.includes(args[i])||options[args[i]]||!args[i+1])throw Error('Invalid or duplicate option');options[args[i]]=args[i+1];}
  if(allowed.some(k=>!options[k]))throw Error('All command options are required');
  const inputs=await captureSystem(path.resolve(options['--root']),options['--system'],{includeCandidates:['queue','review'].includes(command)});
  const service=inputs.manifest.services.find(s=>s.id===options['--service']);
  if(!service)throw Error('Unknown service');
  if(command==='template'){
    const evidence=service.source.files.slice(0,16).map(f=>{const key=`${f.repository}/${f.path}`,p=inputs.provenance[key];if(!p)throw Error('Service must be bound in an environment');
      const line=inputs.files.get(key).split(/\r?\n/).findIndex(l=>l.trim());if(line<0)throw Error('Empty source file');
      return {...p,startLine:line+1,endLine:line+1,quote:inputs.files.get(key).split(/\r?\n/)[line]};});
    const v2=service.source.adapter==='ai-evidence/2';
    await createJson(path.resolve(options['--out']),{schemaVersion:v2?'archi/ai-candidates-v1alpha2':'archi/ai-candidates-v1alpha1',simulation:inputs.manifest.simulation,service:service.id,
      candidates:[{id:'replace-client-id',name:'REPLACE_WITH_CLIENT_SYMBOL',...(v2?{endpoint:{kind:'url-key',key:'REPLACE_WITH_CONFIG_KEY'}}:{endpointKey:'REPLACE_WITH_CONFIG_KEY'}),protocol:'unknown',conditions:[],
        unknowns:['Template only: inspect source, replace placeholders and cite the relevant lines.'],evidence}]});
    console.log('Template saved. Replace placeholders and evidence ranges; no semantics are approved.');
  }else if(command==='check'){
    const bundle=(await readJson(path.resolve(options['--bundle']))).value;
    verifyAiBundle(bundle,{service,simulation:inputs.manifest.simulation,files:inputs.files,provenance:inputs.provenance});
    console.log(JSON.stringify({evidence:'verified against selected Git bytes; semantics unverified',candidates:bundle.candidates.map(c=>({id:c.id,candidateHash:candidateHash(bundle,c)}))},null,2));
  }else if(command==='queue'){
    console.log(JSON.stringify(reviewQueue(inputs,service),null,2));
  }else{
    const request=Object.fromEntries(Object.entries(options).map(([k,v])=>[k.slice(2),v]));
    const {manifest,change}=applyCandidateReview(inputs,service,request);
    await createJson(path.resolve(options['--out']),manifest);
    console.log(JSON.stringify({output:path.resolve(options['--out']),change},null,2));
  }
}catch(e){console.error(e.message);process.exitCode=1;}
