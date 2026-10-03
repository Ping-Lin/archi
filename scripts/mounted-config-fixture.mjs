import {createConfigImportsFixture} from './config-imports-fixture.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse,stringify} from 'yaml';

export async function createMountedConfigFixture(destination,{imports=false}={}){
  const f=await createConfigImportsFixture(destination);
  const chart=path.join(f.root,'deploy/chart/templates/app.yaml');
  let template=await readFile(chart,'utf8');
  template=template.replace('      containers:',`{{- if .Values.mountedConfigDemo }}
      volumes:
        - name: routing-files
          configMap:
            name: routing-files
{{- end }}
      containers:`);
  template=template.replace('          env:',`{{- if .Values.mountedConfigDemo }}
          volumeMounts:
            - name: routing-files
              mountPath: /etc/archi-config
              readOnly: true
{{- end }}
          env:
{{- if .Values.mountedConfigDemo }}
            - name: SPRING_CONFIG_ADDITIONAL_LOCATION
              value: file:/etc/archi-config/routing.properties
{{- end }}`);
  template+=`{{- if .Values.mountedConfigDemo }}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: routing-files
data:
{{- if .Values.mountedConfigImports }}
  routing.properties: "gateway.peer.host=unresolved.invalid\\nspring.config.import=leaf.properties\\n"
  leaf.properties: {{ .Values.mountedConfigDemo | quote }}
{{- else }}
  routing.properties: {{ .Values.mountedConfigDemo | quote }}
{{- end }}
{{- end }}
`;
  await writeFile(chart,template);
  for(const env of f.manifest.environments){
    const file=path.join(f.root,'deploy/values',env.id,'portal.yaml');
    const values=parse(await readFile(file,'utf8'));
    values.mountedConfigDemo=`gateway.peer.host=\${mounted.host}\nmounted.host=api.sales-${env.id}.svc.cluster.local\n`;
    if(imports)values.mountedConfigImports=true;
    await writeFile(file,stringify(values));
    // The imported value is deliberately wrong: only the mounted override resolves it.
    await writeFile(path.join(f.root,'deploy',`routing-${env.id}.properties`),'gateway.peer.host=unresolved.invalid\n');
    const instance=env.instances.find(i=>i.id==='portal');
    instance.configuration={...instance.configuration,adapter:'spring-properties/6',mountedFiles:['/etc/archi-config/routing.properties']};
    if(imports)instance.configuration={...instance.configuration,adapter:'spring-properties/7',mountedImportBindings:[{from:'/etc/archi-config/routing.properties',location:'leaf.properties',file:'/etc/archi-config/leaf.properties'}]};
  }
  const git=args=>execFileSync('git',['-C',path.join(f.root,'deploy'),...args],{encoding:'utf8',env:{...process.env,
    GIT_AUTHOR_NAME:'Archi fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Archi fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',
    GIT_AUTHOR_DATE:'2026-10-03T02:00:00Z',GIT_COMMITTER_DATE:'2026-10-03T02:00:00Z'}});
  git(['add','.']);git(['-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-m','Synthetic mounted ConfigMap files']);
  f.manifest.repositories.find(r=>r.id==='deploy').revision=git(['rev-parse','HEAD']).trim();
  f.manifest.name='Synthetic mounted configuration · no cluster access';
  const accepted=structuredClone(f.manifest);
  accepted.services.find(s=>s.id==='portal').source.reviews=f.accepted.services.find(s=>s.id==='portal').source.reviews;
  await writeFile(f.path,JSON.stringify(f.manifest,null,2)+'\n');
  await writeFile(path.join(f.root,'accepted.json'),JSON.stringify(accepted,null,2)+'\n');
  return {...f,accepted};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==3&&!(process.argv.length===4&&process.argv[3]==='--imports'))throw Error('Usage: node scripts/mounted-config-fixture.mjs NEW_DESTINATION [--imports]');console.log((await createMountedConfigFixture(path.resolve(process.argv[2]),{imports:process.argv[3]==='--imports'})).path);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
