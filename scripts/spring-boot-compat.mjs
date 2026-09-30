import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runAdapter} from '../src/analysis/adapters.mjs';
import {createLedger} from '../src/analysis/contract.mjs';

// Handwritten expected values are independent of both evaluators.
const base='peer.host=orders\npeer.port=7000\n';
const cases=[
  {id:'properties',files:[['application.properties',base]],expected:['orders','7000']},
  {id:'ordered-yaml-overlay',files:[['application.properties',base],['overlay.yaml','peer:\n  host: stock\n  port: 8000\n']],expected:['stock','8000']},
  {id:'environment-override',files:[['application.properties',base]],env:{PEER_PORT:'9000'},expected:['orders','9000']},
  {id:'json-overrides-environment',files:[['application.properties',base]],env:{PEER_PORT:'9000',SPRING_APPLICATION_JSON:'{"peer":{"port":"8080"}}'},expected:['orders','8080']},
  {id:'transitive-placeholder',files:[['application.properties','peer.host=${routing.host}\nrouting.host=orders\npeer.port=${routing.port:8080}\n']],expected:['orders','8080']},
  {id:'empty-is-present',files:[['application.properties','peer.host=${routing.host:orders}\nrouting.host=\npeer.port=8080\n']],expected:['','8080']},
  {id:'explicit-profile-overlay',files:[['base.properties',base],['reviewed-qa.properties','peer.port=8100\n']],expected:['orders','8100']},
  {id:'unsupported-import',files:[['application.properties',base+'spring.config.import=extra.properties\n']],extra:[['extra.properties','peer.port=8200\n']],expected:['orders','8200'],unsupported:true},
  {id:'missing-placeholder',files:[['application.properties','peer.host=${missing}\npeer.port=8080\n']],bootFailure:true,unsupported:true},
  {id:'bound-import',files:[['application.properties',base+'spring.config.import=extra.properties\n']],extra:[['extra.properties','peer.port=8200\n']],imports:[['application.properties','extra.properties','extra.properties']],expected:['orders','8200']},
  {id:'ordered-imports',files:[['application.properties',base+'spring.config.import=first.properties,second.yaml\n']],extra:[['first.properties','peer.port=8100\n'],['second.yaml','peer:\n  port: 8200\n']],imports:[['application.properties','first.properties','first.properties'],['application.properties','second.yaml','second.yaml']],expected:['orders','8200']},
  {id:'nested-import',files:[['application.properties',base+'spring.config.import=nested/extra.properties\n']],extra:[['nested/extra.properties','peer.port=8100\nspring.config.import=leaf.properties\n'],['nested/leaf.properties','peer.port=${final.port:8300}\n']],imports:[['application.properties','nested/extra.properties','nested/extra.properties'],['nested/extra.properties','leaf.properties','nested/leaf.properties']],expected:['orders','8300']},
  {id:'optional-present-import',files:[['application.properties',base+'spring.config.import=optional:extra.properties\n']],extra:[['extra.properties','peer.port=8200\n']],imports:[['application.properties','optional:extra.properties','extra.properties']],expected:['orders','8200']},
  {id:'optional-unbound-import',files:[['application.properties',base+'spring.config.import=optional:missing.properties\n']],imports:[],expected:['orders','7000'],unsupported:true},
  {id:'environment-over-import',files:[['application.properties',base+'spring.config.import=extra.properties\n']],extra:[['extra.properties','peer.port=8200\n']],imports:[['application.properties','extra.properties','extra.properties']],env:{PEER_PORT:'9000'},expected:['orders','9000']},
];
const repo=fileURLToPath(new URL('../',import.meta.url));
const pom=path.join(repo,'examples/spring-boot-compat/pom.xml');
execFileSync(process.env.MVN_BIN??'mvn',['-B','-q',...(process.env.MVN_SETTINGS?['--settings',process.env.MVN_SETTINGS]:[]),'-f',pom,'package','-DskipTests'],{stdio:'inherit',timeout:240000});
const jar=path.join(path.dirname(pom),'target/configuration-probe-1.0.0.jar');
const root=await mkdtemp(path.join(os.tmpdir(),'archi-boot-compat-')),results=[];
try {
  for(const scenario of cases) {
    const cwd=path.join(root,scenario.id);await mkdir(cwd);
    for(const [name,text] of [...scenario.files,...(scenario.extra??[])]){await mkdir(path.dirname(path.join(cwd,name)),{recursive:true});await writeFile(path.join(cwd,name),text);}
    const variables={SPRING_PROFILES_ACTIVE:'qa',...(scenario.env??{})};
    const run=spawnSync(process.env.JAVA_BIN??'java',['-jar',jar,'--spring.config.location='+scenario.files.map(([name])=>pathToFileURL(path.join(cwd,name)).href).join(',')],
      {cwd,env:{PATH:process.env.PATH,LANG:'C.UTF-8',...variables},encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
    if(run.error)throw run.error;
    const observed=Object.fromEntries(run.stdout.split('\n').filter(l=>l.startsWith('ARCHI_PROBE:')).map(l=>{
      const [,key,value]=l.split(':');return [key,Buffer.from(value,'base64').toString('utf8')];
    }));
    const properties=runAdapter(scenario.imports?'spring-properties/5':'spring-properties/4',{
      files:new Map([...scenario.files,...(scenario.extra??[])]),env:{id:'qa',profiles:['qa'],propertiesComplete:true,propertyFiles:scenario.files.map(([name])=>name),environmentBindings:scenario.env?.PEER_PORT?[{name:'PEER_PORT',key:'peer.port'}]:[],...(scenario.imports?{importProfilePolicy:'no-variants-reviewed',importBindings:scenario.imports.map(([from,location,file])=>({from,location,file}))}:{})},
      source:{service:'probe'},ledger:createLedger('qa','probe'),resources:[{kind:'Deployment',key:'probe',service:'probe',spec:{template:{spec:{containers:[{env:Object.entries(variables).map(([name,value])=>({name,value}))}]}}}}],
    });
    if(scenario.bootFailure){
      assert.notEqual(run.status,0,scenario.id+' must fail in Spring');
      assert.match(run.stdout+run.stderr,/Could not resolve placeholder 'missing'/,'Failure must be the expected missing placeholder, not a launcher error');
    }
    else {
      assert.equal(run.status,0,scenario.id+' Spring failed: '+run.stderr+'\n'+run.stdout);
      assert.equal(observed.version,'3.5.6');
      for(const mode of ['environment','binding'])assert.deepEqual([observed[mode+'.host'],observed[mode+'.port']],scenario.expected,scenario.id+' '+mode);
    }
    assert.equal(properties.complete,!scenario.unsupported,scenario.id+' Archi completeness');
    if(!scenario.unsupported)assert.deepEqual([properties.values['peer.host'],properties.values['peer.port']],scenario.expected,scenario.id+' Archi values');
    results.push({id:scenario.id,status:scenario.unsupported?'unsupported-correctly-blocked':'matched',springBoot:scenario.bootFailure?'startup-failed':observed.version,expected:scenario.expected??null,diagnostics:properties.diagnostics.map(d=>d.code)});
    console.log(scenario.id+': '+results.at(-1).status);
  }
  const out=path.join(repo,'artifacts/spring-boot-compat');await mkdir(out,{recursive:true});
  await writeFile(path.join(out,'report.json'),JSON.stringify({completedAt:new Date().toISOString(),springBoot:'3.5.6',java:spawnSync(process.env.JAVA_BIN??'java',['-version'],{encoding:'utf8'}).stderr.trim(),scope:'Configuration values only; synthetic inputs; no Kubernetes or network client execution',results},null,2)+'\n');
}finally{await rm(root,{recursive:true,force:true});}
