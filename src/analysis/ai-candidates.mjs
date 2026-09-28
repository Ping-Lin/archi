import Ajv from 'ajv';
import { hash, identify } from './contract.mjs';
import { endpointBindingSchema, endpointKeys } from './endpoint-binding.mjs';

const text = {type:'string',minLength:1,maxLength:2048};
const digest = {type:'string',pattern:'^[a-f0-9]{64}$'};
const object = properties => ({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const list = (items,maxItems=100) => ({type:'array',items,maxItems});
export const aiCandidateSchema = object({
  schemaVersion:{const:'archi/ai-candidates-v1alpha1'}, simulation:{type:'boolean'}, service:text,
  candidates:list(object({
    id:{...text,pattern:'^[a-z][a-z0-9.-]{0,63}$'}, name:text,
    endpointKey:text, protocol:{enum:['HTTP','HTTPS','TCP','gRPC','unknown']},
    conditions:list({oneOf:[object({kind:{const:'profile'},value:text}),object({kind:{const:'property'},key:text,value:text})]},32),
    unknowns:list(text,32),
    evidence:{...list(object({repository:text,revision:{type:'string',pattern:'^[a-f0-9]{40}$'},path:text,contentHash:digest,
      startLine:{type:'integer',minimum:1,maximum:1000000},endLine:{type:'integer',minimum:1,maximum:1000000},quote:{...text,maxLength:16000}}),16),minItems:1},
  }),500),
});
const validate = new Ajv({allErrors:true}).compile(aiCandidateSchema);
export const aiCandidateSchemaV2=structuredClone(aiCandidateSchema);
aiCandidateSchemaV2.properties.schemaVersion={const:'archi/ai-candidates-v1alpha2'};
const candidateV2=aiCandidateSchemaV2.properties.candidates.items;
delete candidateV2.properties.endpointKey;
candidateV2.properties.endpoint=endpointBindingSchema;
candidateV2.required=candidateV2.required.filter(k=>k!=='endpointKey').concat('endpoint');
const validateV2=new Ajv({allErrors:true}).compile(aiCandidateSchemaV2);
export const candidateHash = (bundle,candidate) => hash({schemaVersion:bundle.schemaVersion,simulation:bundle.simulation,service:bundle.service,candidate});
export function verifyAiBundle(bundle,{service,simulation,files,provenance}) {
  const validator=service.source.adapter==='ai-evidence/2'?validateV2:validate;
  if (!validator(bundle)) throw Error('Invalid AI candidate bundle: '+JSON.stringify(validator.errors));
  if (bundle.service!==service.id || bundle.simulation!==simulation) throw Error('AI candidate service or input mode mismatch');
  const allowed = new Set(service.source.files.map(f=>`${f.repository}/${f.path}`)), ids=new Set();
  for (const c of bundle.candidates) {
    if (ids.has(c.id)) throw Error('Duplicate AI candidate id'); ids.add(c.id);
    for (const e of c.evidence) {
      const key=`${e.repository}/${e.path}`, p=provenance[key], content=files.get(key);
      if (!allowed.has(key)||!p||p.revision!==e.revision||p.contentHash!==e.contentHash||hash(content)!==e.contentHash)
        throw Error('AI evidence is outside selected source files or has stale revision/hash');
      const lines=content.split(/\r?\n/);
      if(e.endLine<e.startLine||e.endLine>lines.length||lines.slice(e.startLine-1,e.endLine).join('\n')!==e.quote)
        throw Error('AI evidence line range or quote mismatch');
    }
  }
  return bundle;
}
export function extractAiCandidates(context) {
  const {files,source,env,ledger,service,provenance,simulation}=context;
  const raw=files.get(source.candidateFile);
  if(typeof raw!=='string'||Buffer.byteLength(raw)>2*1024*1024)throw Error('AI candidate input missing or exceeds 2 MiB');
  const bundle=verifyAiBundle(JSON.parse(raw),{service,simulation,files,provenance});
  const hashes=new Set(bundle.candidates.map(c=>candidateHash(bundle,c)));
  for(const r of service.source.reviews)if(!hashes.has(r.candidateHash))throw Error('Stale AI review: candidate hash is absent');
  const bundleEvidence=ledger.recordEvidence({type:'ai_candidate_bundle',locator:source.candidateFile,contentHash:hash(raw)});
  const candidates=bundle.candidates.map(c=>{
    const digest=candidateHash(bundle,c), review=service.source.reviews.find(r=>r.candidateHash===digest&&r.environment===env.id&&r.instance===source.service);
    const status=review?.decision??'unreviewed';
    const unsupported=[...c.unknowns];
    if(status!=='accepted')unsupported.push(status==='rejected'?'Reviewer rejected this AI candidate':'AI semantics unreviewed; matching evidence bytes do not prove interpretation');
    if(!['HTTP','HTTPS','TCP'].includes(c.protocol))unsupported.push('Protocol needs a supported endpoint adapter; no protocol conversion is inferred');
    const evidenceIds=[bundleEvidence,...c.evidence.map(e=>ledger.recordEvidence({type:'ai_source_reference',locator:`${e.repository}/${e.path}`,contentHash:e.contentHash,
      provenance:{repository:e.repository,revision:e.revision,path:e.path,contentHash:e.contentHash},startLine:e.startLine,endLine:e.endLine,quote:e.quote}))];
    if(review)evidenceIds.push(ledger.recordEvidence({type:'declared_candidate_review',locator:`system.manifest/services/${service.id}/reviews`,contentHash:hash(review),review}));
    const id=identify('candidate',{environment:env.id,source:source.service,adapter:service.source.adapter,candidate:c.id});
    const extraction={method:'ai-assisted',status,candidateHash:digest,protocol:c.protocol,reviewer:review?.reviewer??null,reason:review?.reason??null};
    return {id,name:c.name,source:source.service,file:`${c.evidence[0].repository}/${c.evidence[0].path}`,line:c.evidence[0].startLine,
      key:c.endpoint ? endpointKeys(c.endpoint).join(' + ') : c.endpointKey,
      ...(c.endpoint?{endpointBinding:c.endpoint}:{}),conditions:c.conditions,unsupported,extraction,
      factId:ledger.fact('client.candidate',id,{name:c.name,...(c.endpoint?{endpointBinding:c.endpoint}:{key:c.endpointKey}),conditions:c.conditions,unsupported,extraction},evidenceIds)};
  });
  return {candidates,diagnostics:[{code:'AI_SEMANTICS_REVIEW',message:'AI candidates are evidence-bound proposals. Accepted reviews are local operator assertions, not authenticated approval or parser verification.'}],
    coverage:{collector:'ai-evidence',status:'partial',scope:source.files,meaning:'Supplied candidates only; omitted clients are not proven absent. Property semantics are limited to the selected configuration adapter.'}};
}
