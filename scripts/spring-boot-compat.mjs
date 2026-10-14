import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runAdapter} from '../src/analysis/adapters.mjs';
import {createLedger} from '../src/analysis/contract.mjs';

// Handwritten expected values are independent of both evaluators.
const base='peer.host=orders\npeer.port=7000\n';
const cases=[
  {id:'mounted-profile-root',profiles:['qa'],profileBases:['application.properties'],files:[['application.properties',base]],mounted:[['routing.properties','peer.port=8100'],['routing-qa.properties','peer.port=8200']],mountedRoots:['routing.properties'],mountedProfileBases:['routing.properties'],expected:['orders','8200']},
  {id:'mounted-profile-import',profiles:['qa'],profileBases:['application.properties'],files:[['application.properties',base]],mounted:[['routing.properties','spring.config.import=leaf.properties'],['routing-qa.properties','peer.port=8100'],['leaf.properties','peer.port=8200'],['leaf-qa.properties','peer.port=8300']],mountedRoots:['routing.properties'],mountedImports:[['routing.properties','leaf.properties','leaf.properties']],mountedProfileBases:['routing.properties','leaf.properties'],expected:['orders','8300']},
  {id:'mounted-profile-order',profiles:['blue','qa'],profileBases:['application.properties'],files:[['application.properties',base]],mounted:[['routing.properties','peer.port=8000'],['routing-qa.properties','peer.port=8100'],['routing-blue.properties','peer.port=8200']],mountedRoots:['routing.properties'],mountedProfileBases:['routing.properties'],expected:['orders','8100']},
  {id:'mounted-profile-default',profiles:[],profileBases:['application.properties'],files:[['application.properties',base]],mounted:[['routing.properties','peer.port=8000'],['routing-default.properties','peer.port=8400']],mountedRoots:['routing.properties'],mountedProfileBases:['routing.properties'],expected:['orders','8400']},
  {id:'mounted-profile-declared-import',profiles:['qa'],profileBases:['application.properties'],files:[['application.properties',base]],mounted:[['routing.properties','peer.port=8000'],['routing-qa.properties','spring.config.import=leaf.yaml'],['leaf.yaml','peer:\n  port: 8500']],mountedRoots:['routing.properties'],mountedImports:[['routing-qa.properties','leaf.yaml','leaf.yaml']],mountedProfileBases:['routing.properties','leaf.yaml'],expected:['orders','8500']},
  {id:'mounted-base-over-repository-profile',profiles:['qa'],profileBases:['application.properties'],files:[['application.properties',base]],extra:[['application-qa.properties','peer.port=9900']],mounted:[['routing.properties','peer.port=8600']],mountedRoots:['routing.properties'],mountedProfileBases:['routing.properties'],expected:['orders','8600']},
  {id:'environment-over-mounted-profile',profiles:['qa'],profileBases:['application.properties'],files:[['application.properties',base]],mounted:[['routing.properties','peer.port=8000'],['routing-qa.properties','peer.port=8100']],mountedRoots:['routing.properties'],mountedProfileBases:['routing.properties'],env:{PEER_PORT:'9000'},expected:['orders','9000']},
  {id:'json-over-mounted-profile',profiles:['qa'],profileBases:['application.properties'],files:[['application.properties',base]],mounted:[['routing.properties','peer.port=8000'],['routing-qa.properties','peer.port=8100']],mountedRoots:['routing.properties'],mountedProfileBases:['routing.properties'],env:{PEER_PORT:'9000',SPRING_APPLICATION_JSON:'{"peer.port":"9090"}'},expected:['orders','9090']},
  {id:'profile-mixed-import-trees',profiles:['qa','blue'],files:[['application.properties',base+'spring.config.import=extra.properties']],extra:[['extra.properties','peer.port=7100'],['extra-qa.properties','peer.port=7200'],['application-blue.properties','spring.config.import=leaf.properties'],['leaf.properties','peer.port=7500']],imports:[['application.properties','extra.properties','extra.properties'],['application-blue.properties','leaf.properties','leaf.properties']],profileBases:['application.properties','extra.properties','leaf.properties'],expected:['orders','7200']},
  {id:'profile-early-file-import',profiles:['qa','blue'],files:[['application.properties',base]],extra:[['application-qa.properties','spring.config.import=leaf.properties'],['application-blue.properties','peer.port=7400'],['leaf.properties','peer.port=7500']],imports:[['application-qa.properties','leaf.properties','leaf.properties']],profileBases:['application.properties','leaf.properties'],expected:['orders','7400']},
  {id:'profile-root-and-import',profiles:['qa','blue'],files:[['application.properties',base+'spring.config.import=extra.properties']],extra:[['extra.properties','peer.port=7100'],['extra-qa.properties','peer.port=7200'],['application-qa.properties','peer.port=7300'],['application-blue.properties','peer.port=7400']],imports:[['application.properties','extra.properties','extra.properties']],profileBases:['application.properties','extra.properties'],expected:['orders','7200']},
  {id:'profile-root-over-base-import',profiles:['qa'],files:[['application.properties',base+'spring.config.import=extra.properties']],extra:[['extra.properties','peer.port=7100'],['application-qa.properties','peer.port=7300']],imports:[['application.properties','extra.properties','extra.properties']],profileBases:['application.properties','extra.properties'],expected:['orders','7300']},
  {id:'profile-ordered-imports',profiles:['qa'],files:[['application.properties',base+'spring.config.import=first.properties,last.properties']],extra:[['first.properties','peer.port=7100'],['first-qa.properties','peer.port=7200'],['last.properties','peer.port=7300']],imports:[['application.properties','first.properties','first.properties'],['application.properties','last.properties','last.properties']],profileBases:['application.properties','first.properties','last.properties'],expected:['orders','7200']},
  {id:'profile-reverse-order',profiles:['blue','qa'],files:[['application.properties',base]],extra:[['application-qa.properties','peer.port=7300'],['application-blue.properties','peer.port=7400']],profileBases:['application.properties'],expected:['orders','7300']},
  {id:'profile-import-only',profiles:['qa'],files:[['application.properties',base+'spring.config.import=extra.properties']],extra:[['extra.properties','peer.port=7100'],['extra-qa.properties','peer.port=7200']],imports:[['application.properties','extra.properties','extra.properties']],profileBases:['application.properties','extra.properties'],expected:['orders','7200']},
  {id:'profile-file-nested-import',profiles:['qa'],files:[['application.properties',base]],extra:[['application-qa.properties','spring.config.import=leaf.properties'],['leaf.properties','peer.port=7500']],imports:[['application-qa.properties','leaf.properties','leaf.properties']],profileBases:['application.properties','leaf.properties'],expected:['orders','7500']},
  {id:'profile-default',profiles:[],files:[['application.properties',base]],extra:[['application-default.properties','peer.port=7600']],profileBases:['application.properties'],expected:['orders','7600']},
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
  {id:'mounted-additional-file',files:[['application.properties',base]],mounted:[['routing.properties','peer.host=${routing.host}\nrouting.host=stock\npeer.port=8100\n']],expected:['stock','8100']},
  {id:'ordered-mounted-files',files:[['application.properties',base]],mounted:[['routing.properties','peer.port=8100\n'],['override.yaml','peer:\n  port: 8200\n']],expected:['orders','8200']},
  {id:'environment-over-mounted',files:[['application.properties',base]],mounted:[['routing.properties','peer.port=8100\n']],env:{PEER_PORT:'9000'},expected:['orders','9000']},
  {id:'json-over-mounted-and-env',files:[['application.properties',base]],mounted:[['routing.properties','peer.port=8100\n']],env:{PEER_PORT:'9000',SPRING_APPLICATION_JSON:'{"peer.port":"9090"}'},expected:['orders','9090']},
  {id:'mounted-bound-import',files:[['application.properties',base]],mounted:[['routing.properties','peer.port=8100\nspring.config.import=leaf.properties'],['leaf.properties','peer.port=8200']],mountedRoots:['routing.properties'],mountedImports:[['routing.properties','leaf.properties','leaf.properties']],expected:['orders','8200']},
  {id:'mounted-nested-import',files:[['application.properties',base]],mounted:[['routing.properties','spring.config.import=leaf.properties'],['leaf.properties','spring.config.import=last.yaml'],['last.yaml','peer:\n  port: 8300']],mountedRoots:['routing.properties'],mountedImports:[['routing.properties','leaf.properties','leaf.properties'],['leaf.properties','last.yaml','last.yaml']],expected:['orders','8300']},
  {id:'mounted-ordered-imports',files:[['application.properties',base]],mounted:[['routing.properties','spring.config.import=first.properties,last.yaml'],['first.properties','peer.port=8200'],['last.yaml','peer:\n  port: 8300']],mountedRoots:['routing.properties'],mountedImports:[['routing.properties','first.properties','first.properties'],['routing.properties','last.yaml','last.yaml']],expected:['orders','8300']},
  {id:'mounted-optional-present',files:[['application.properties',base]],mounted:[['routing.properties','spring.config.import=optional:leaf.properties'],['leaf.properties','peer.port=8200']],mountedRoots:['routing.properties'],mountedImports:[['routing.properties','optional:leaf.properties','leaf.properties']],expected:['orders','8200']},
  {id:'mounted-optional-missing',files:[['application.properties',base]],mounted:[['routing.properties','spring.config.import=optional:missing.properties']],mountedImports:[],expected:['orders','7000'],unsupported:true},
  {id:'environment-over-mounted-import',files:[['application.properties',base]],mounted:[['routing.properties','spring.config.import=leaf.properties'],['leaf.properties','peer.port=8200']],mountedRoots:['routing.properties'],mountedImports:[['routing.properties','leaf.properties','leaf.properties']],env:{PEER_PORT:'9000'},expected:['orders','9000']},
];
const repo=fileURLToPath(new URL('../',import.meta.url));
const pom=path.join(repo,'examples/spring-boot-compat/pom.xml');
if(process.env.CI&&process.env.ARCHI_BOOT_PROBE_JAR)throw Error('CI must rebuild the Boot probe');
if(!process.env.ARCHI_BOOT_PROBE_JAR)execFileSync(process.env.MVN_BIN??'mvn',['-B','-q',...(process.env.MVN_SETTINGS?['--settings',process.env.MVN_SETTINGS]:[]),'-f',pom,'package','-DskipTests'],{stdio:'inherit',timeout:240000});
else console.log('Using explicit prebuilt Boot probe; Maven rebuild skipped');
const jar=process.env.ARCHI_BOOT_PROBE_JAR?path.resolve(process.env.ARCHI_BOOT_PROBE_JAR):path.join(path.dirname(pom),'target/configuration-probe-1.0.0.jar');
const probe={build:process.env.ARCHI_BOOT_PROBE_JAR?'prebuilt-reused':'maven-rebuilt',sha256:createHash('sha256').update(await readFile(jar)).digest('hex')};
const root=await mkdtemp(path.join(os.tmpdir(),'archi-boot-compat-')),results=[];
try {
  for(const scenario of cases) {
    const cwd=path.join(root,scenario.id);await mkdir(cwd);
    for(const [name,text] of [...scenario.files,...(scenario.extra??[]),...(scenario.mounted??[])]){await mkdir(path.dirname(path.join(cwd,name)),{recursive:true});await writeFile(path.join(cwd,name),text);}
    const variables={SPRING_PROFILES_ACTIVE:(scenario.profiles??['qa']).join(','),...(scenario.env??{})};
    const mountedFiles=scenario.mounted?(scenario.mountedRoots??scenario.mounted.map(([name])=>name)).map(name=>path.join(cwd,name)):undefined;
    if(mountedFiles)variables.SPRING_CONFIG_ADDITIONAL_LOCATION=mountedFiles.map(p=>'file:'+p).join(',');
    const run=spawnSync(process.env.JAVA_BIN??'java',['-jar',jar,'--spring.config.location='+scenario.files.map(([name])=>pathToFileURL(path.join(cwd,name)).href).join(',')],
      {cwd,env:{PATH:process.env.PATH,LANG:'C.UTF-8',...variables},encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
    if(run.error)throw run.error;
    const observed=Object.fromEntries(run.stdout.split('\n').filter(l=>l.startsWith('ARCHI_PROBE:')).map(l=>{
      const [,key,value]=l.split(':');return [key,Buffer.from(value,'base64').toString('utf8')];
    }));
    const profileBindings=scenario.profileBases?.flatMap(from=>(scenario.profiles.length?scenario.profiles:['default']).map(profile=>{
      const variant=from.replace(/(\.(?:properties|ya?ml))$/,`-${profile}$1`);
      return {from,profile,file:[...scenario.files,...(scenario.extra??[])].some(([name])=>name===variant)?variant:null};
    }));
    const mountedProfileBindings=scenario.mountedProfileBases?.flatMap(from=>(scenario.profiles.length?scenario.profiles:['default']).map(profile=>{
      const variant=from.replace(/(\.(?:properties|ya?ml))$/,`-${profile}$1`);
      return {from:path.join(cwd,from),profile,file:scenario.mounted.some(([name])=>name===variant)?path.join(cwd,variant):null};
    }));
    const properties=runAdapter(scenario.mountedProfileBases?'spring-properties/9':scenario.profileBases?'spring-properties/8':scenario.mountedImports?'spring-properties/7':scenario.mounted?'spring-properties/6':scenario.imports?'spring-properties/5':'spring-properties/4',{
      files:new Map([...scenario.files,...(scenario.extra??[])]),env:{id:'qa',cluster:'fixture',namespace:'probe',profiles:scenario.profiles??['qa'],propertiesComplete:true,propertyFiles:scenario.files.map(([name])=>name),environmentBindings:scenario.env?.PEER_PORT?[{name:'PEER_PORT',key:'peer.port'}]:[],...(scenario.imports||scenario.mounted||scenario.profileBases?{importProfilePolicy:scenario.profileBases?'explicit-variants-reviewed':'no-variants-reviewed',importBindings:(scenario.imports??[]).map(([from,location,file])=>({from,location,file}))}:{}),...(profileBindings?{profileBindings}:{}),...(mountedFiles?{mountedFiles}:{}),...(mountedProfileBindings?{mountedProfileBindings}:{}),...(scenario.mountedImports?{mountedImportBindings:scenario.mountedImports.map(([from,location,file])=>({from:path.join(cwd,from),location,file:path.join(cwd,file)}))}:{})},
      source:{service:'probe'},ledger:createLedger('qa','probe'),resources:[{kind:'Deployment',key:'probe',service:'probe',spec:{template:{spec:{...(mountedFiles?{volumes:[{name:'config',configMap:{name:'settings'}}]}:{}),containers:[{env:Object.entries(variables).map(([name,value])=>({name,value})),...(mountedFiles?{volumeMounts:[{name:'config',mountPath:cwd}]}:{})}]}}}},...(mountedFiles?[{kind:'ConfigMap',key:'fixture||configmaps|probe|settings',data:Object.fromEntries(scenario.mounted)}]:[])],
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
  await writeFile(path.join(out,'report.json'),JSON.stringify({probe,completedAt:new Date().toISOString(),springBoot:'3.5.6',java:spawnSync(process.env.JAVA_BIN??'java',['-version'],{encoding:'utf8'}).stderr.trim(),scope:'Configuration values only; synthetic inputs; no Kubernetes or network client execution',results},null,2)+'\n');
}finally{await rm(root,{recursive:true,force:true});}
