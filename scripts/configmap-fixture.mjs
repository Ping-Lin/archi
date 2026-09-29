import {createGrpcFixture} from './grpc-fixture.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse,stringify} from 'yaml';

export async function createConfigMapFixture(destination) {
  const f=await createGrpcFixture(destination);
  const chart=path.join(f.root,'deploy','chart','templates','app.yaml');
  let template=await readFile(chart,'utf8');
  template=template.replace('          env:',`{{- if .Values.configMapDemo }}
          envFrom:
            - prefix: ROUTING_
              configMapRef:
                name: route-defaults
{{- end }}
          env:`);
  template=template.replace('{{- range .Values.extraEnv }}',`{{- if .Values.configMapDemo }}
            - name: PEER_PORT
              valueFrom:
{{- if .Values.opaqueSecretDemo }}
                secretKeyRef:
                  name: synthetic-credential
                  key: port
{{- else }}
                configMapKeyRef:
                  name: route-overrides
                  key: port
{{- end }}
            - name: GRPC_TARGET
              valueFrom:
                configMapKeyRef:
                  name: route-overrides
                  key: target
{{- end }}
{{- range .Values.extraEnv }}`);
  template+=`{{- if .Values.configMapDemo }}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: route-defaults
data:
  HOST: {{ .Values.configMapDemo.host | quote }}
  PORT: "7000"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: route-overrides
data:
  port: "8000"
  target: {{ .Values.configMapDemo.target | quote }}
{{- end }}
{{- if .Values.opaqueSecretDemo }}
---
apiVersion: v1
kind: Secret
metadata:
  name: synthetic-credential
  annotations:
    synthetic-only: fixture-secret-marker-not-a-credential
stringData:
  port: fixture-secret-marker-not-a-credential
{{- end }}
`;
  await writeFile(chart,template);
  for(const env of f.manifest.environments) {
    const file=path.join(f.root,'deploy','values',env.id,'portal.yaml'),values=parse(await readFile(file,'utf8'));
    values.extraEnv=[];
    values.opaqueSecretDemo=env.id==='production';
    values.configMapDemo={host:`api.sales-${env.id}.svc.cluster.local`,target:`dns:///api.sales-${env.id}.svc.cluster.local:9090`};
    values.application={'routing.port':'9090'};
    await writeFile(file,stringify(values));
    const instance=env.instances.find(i=>i.id==='portal');
    instance.configuration={adapter:'spring-properties/4',environmentBindings:[
      {name:'ROUTING_HOST',key:'routing.host'},
      {name:'ROUTING_PORT',key:'routing.base-port'},
      {name:'PEER_PORT',key:'routing.port'},
      {name:'GRPC_TARGET',key:'grpc.orders.target'},
    ]};
  }
  const git=args=>execFileSync('git',['-C',path.join(f.root,'deploy'),...args],{encoding:'utf8',env:{...process.env,
    GIT_AUTHOR_NAME:'Archi fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Archi fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',
    GIT_AUTHOR_DATE:'2026-09-29T10:00:00Z',GIT_COMMITTER_DATE:'2026-09-29T10:00:00Z'}});
  git(['add','.']);git(['-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-m','Synthetic rendered ConfigMap references']);
  f.manifest.repositories.find(r=>r.id==='deploy').revision=git(['rev-parse','HEAD']).trim();
  f.manifest.name='Synthetic ConfigMap environment · rendered references, no cluster reads';
  const accepted=structuredClone(f.manifest);
  accepted.services.find(s=>s.id==='portal').source.reviews=f.accepted.services.find(s=>s.id==='portal').source.reviews;
  await writeFile(f.path,JSON.stringify(f.manifest,null,2)+'\n');
  await writeFile(path.join(f.root,'accepted.json'),JSON.stringify(accepted,null,2)+'\n');
  return {...f,accepted};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{if(process.argv.length!==3)throw Error('Usage: node scripts/configmap-fixture.mjs NEW_DESTINATION');console.log((await createConfigMapFixture(path.resolve(process.argv[2]))).path);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
