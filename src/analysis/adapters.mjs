import { extractSpring, resolveProperties } from "./spring.mjs";
import { renderHelm } from "./helm.mjs";
import Ajv from "ajv";
import { extractAiCandidates } from './ai-candidates.mjs';
import { parsePropertyFile, flattenProperties } from './property-files.mjs';
import { applyPlaceholders } from './placeholders.mjs';
import { resolveConfigMapEnvironment } from './configmap-env.mjs';
import { resolveConfigImports } from './config-imports.mjs';
import {resolveMountedConfig} from './mounted-config.mjs';

const records = { type: "array", items: { type: "object" } };
const coverage = {
  type: "object",
  required: ["collector", "status", "meaning"],
  properties: {
    collector: { type: "string" },
    status: { enum: ["complete", "partial"] },
    meaning: { type: "string" },
  },
};
const result = (required, properties) => ({
  type: "object",
  required: [...required, "diagnostics"],
  properties: { ...properties, diagnostics: records },
});
export const adapterResultSchemas = Object.freeze({
  'spring-properties/9':result(['values','chains','scopeFact','complete'],{values:{type:'object'},chains:{type:'object'},scopeFact:{type:'string'},complete:{type:'boolean'}}),
  'spring-properties/8':result(['values','chains','scopeFact','complete'],{values:{type:'object'},chains:{type:'object'},scopeFact:{type:'string'},complete:{type:'boolean'}}),
  'spring-properties/7':result(['values','chains','scopeFact','complete'],{values:{type:'object'},chains:{type:'object'},scopeFact:{type:'string'},complete:{type:'boolean'}}),
  'spring-properties/6':result(['values','chains','scopeFact','complete'],{values:{type:'object'},chains:{type:'object'},scopeFact:{type:'string'},complete:{type:'boolean'}}),
  'spring-properties/5':result(['values','chains','scopeFact','complete'],{values:{type:'object'},chains:{type:'object'},scopeFact:{type:'string'},complete:{type:'boolean'}}),
  'spring-properties/4':result(['values','chains','scopeFact','complete'],{values:{type:'object'},chains:{type:'object'},scopeFact:{type:'string'},complete:{type:'boolean'}}),
  'ai-evidence/3':result(['candidates','coverage'],{candidates:records,coverage}),
  'spring-properties/3':result(['values','chains','scopeFact','complete'],{values:{type:'object'},chains:{type:'object'},scopeFact:{type:'string'},complete:{type:'boolean'}}),
  'ai-evidence/2':result(['candidates','coverage'],{candidates:records,coverage}),
  'spring-properties/2':result(['values','chains','scopeFact','complete'],{values:{type:'object'},chains:{type:'object'},scopeFact:{type:'string'},complete:{type:'boolean'}}),
  'ai-evidence/1':result(['candidates','coverage'],{candidates:records,coverage}),
  "spring-explicit-bean/1": result(["candidates", "coverage"], {
    candidates: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "source", "file", "name", "factId"],
        properties: Object.fromEntries(
          ["id", "source", "file", "name", "factId"].map((k) => [
            k,
            { type: "string" },
          ]),
        ),
      },
    },
    coverage,
  }),
  "spring-properties/1": result(["values", "chains", "scopeFact", "complete"], {
    values: { type: "object" },
    chains: { type: "object" },
    scopeFact: { type: "string" },
    complete: { type: "boolean" },
  }),
  "helm-template/1": result(
    ["resources", "manifest", "outputHash", "version", "coverage"],
    {
      resources: records,
      manifest: { type: "string" },
      outputHash: { type: "string" },
      version: { type: "string" },
      coverage,
    },
  ),
});
const ajv = new Ajv(),
  validators = Object.fromEntries(
    Object.entries(adapterResultSchemas).map(([id, schema]) => [
      id,
      ajv.compile(schema),
    ]),
  );
export function validateAdapterResult(id, result) {
  if (!validators[id]?.(result)) throw Error(`Invalid adapter result: ${id}`);
  return result;
}

// Closed, versioned built-ins. A manifest selects an adapter, never executable code.
export const adapterContracts = Object.freeze({
  'spring-properties/9':Object.freeze({input:'v8-config-scope + explicit-mounted-profile-bindings',output:'effective-values + mount-profile-and-import-evidence + diagnostics',engine:'mounted-configmap-files/3 + bound-profile-imports/1 + rendered-configmap-env/1 + closed-scope-placeholders/1'}),
  'spring-properties/8':Object.freeze({input:'v5-config-scope + explicit-profile-bindings',output:'effective-values + profile-and-import-evidence + diagnostics',engine:'bound-profile-imports/1 + rendered-configmap-env/1 + closed-scope-placeholders/1'}),
  'spring-properties/7':Object.freeze({input:'v6-config-scope + explicit-mounted-import-bindings',output:'effective-values + mount-and-import-evidence + diagnostics',engine:'mounted-configmap-files/2 + bound-config-imports/1 + rendered-configmap-env/1 + closed-scope-placeholders/1'}),
  'spring-properties/6':Object.freeze({input:'v5-config-scope + explicit-mounted-configmap-files',output:'effective-values + mount-evidence + diagnostics',engine:'mounted-configmap-files/1 + bound-config-imports/1 + rendered-configmap-env/1 + closed-scope-placeholders/1'}),
  'spring-properties/5':Object.freeze({input:'v4-config-scope + explicitly-bound-import-tree',output:'effective-values + import-evidence + diagnostics',engine:'bound-config-imports/1 + rendered-configmap-env/1 + closed-scope-placeholders/1'}),
  'spring-properties/4':Object.freeze({input:'v3-config-scope + rendered-configmap-env',output:'effective-values + scoped-reference-evidence + diagnostics',engine:'rendered-configmap-env/1 + closed-scope-placeholders/1'}),
  'ai-evidence/3':Object.freeze({input:'pinned-source + scoped-endpoint-bindings + declared-reviews',output:'candidates + coverage + diagnostics',engine:'evidence-validation/3 + grpc-endpoint/1'}),
  'spring-properties/3':Object.freeze({input:'v2-config-scope + exact-key-placeholders',output:'effective-values + transitive-evidence + diagnostics',engine:'closed-scope-placeholders/1'}),
  'ai-evidence/2':Object.freeze({input:'pinned-source + endpoint-binding-bundle + scoped-declared-reviews',output:'candidates + coverage + diagnostics',engine:'evidence-validation/2'}),
  'spring-properties/2':Object.freeze({input:'ordered-properties-or-yaml + explicit-env-bindings + application-json + bound-workload',output:'values + chains + scopeFact + diagnostics',engine:'bounded-property-files/1'}),
  'ai-evidence/1':Object.freeze({input:'pinned-source + candidate-bundle + scoped-declared-reviews',output:'candidates + coverage + diagnostics',engine:'evidence-validation/1'}),
  "spring-explicit-bean/1": Object.freeze({
    input: "captured-java-files + caller-scope",
    output: "candidates + coverage + diagnostics",
    engine: "java-parser@3.0.1",
  }),
  "spring-properties/1": Object.freeze({
    input: "ordered-yaml + bound-workload + caller-policy",
    output: "values + chains + scopeFact + diagnostics",
    engine: "yaml@2.9.1",
  }),
  "helm-template/1": Object.freeze({
    input: "captured-chart + release-scope",
    output: "resources + manifest + outputHash + coverage + diagnostics",
    engine: "helm@v3.17.3",
  }),
});
export function runAdapter(id, context) {
  let result;
  if(['spring-properties/8','spring-properties/9'].includes(id))result=resolveProperties(context.files,context.env,context.resources,context.source,context.ledger,{
    parseFile:parsePropertyFile,flatten:flattenProperties,environmentBindings:context.env.environmentBindings??[],
    placeholders:applyPlaceholders,environmentResolver:resolveConfigMapEnvironment,adapter:id,orderedProfiles:true,
    fileResolver:(files,env,ledger)=>resolveConfigImports(files,env,ledger,{profiles:true}),
    ...(id==='spring-properties/9'?{mountResolver:(...args)=>resolveMountedConfig(...args,{imports:true,profiles:true})}:{}),
  });
  else if (id === "spring-explicit-bean/1")
    result = extractSpring(
      context.files,
      context.source,
      context.env,
      context.ledger,
    );
  else if (['ai-evidence/1','ai-evidence/2','ai-evidence/3'].includes(id)) result=extractAiCandidates(context);
  else if (['spring-properties/2','spring-properties/3','spring-properties/4','spring-properties/5','spring-properties/6','spring-properties/7'].includes(id)) result=resolveProperties(context.files,context.env,context.resources,context.source,context.ledger,{
    parseFile:parsePropertyFile,flatten:flattenProperties,environmentBindings:context.env.environmentBindings ?? [],
    ...(id!=='spring-properties/2'?{placeholders:applyPlaceholders}:{}),
    ...(['spring-properties/4','spring-properties/5','spring-properties/6','spring-properties/7'].includes(id)?{environmentResolver:resolveConfigMapEnvironment,adapter:id}:{}),
    ...(['spring-properties/5','spring-properties/6','spring-properties/7'].includes(id)?{fileResolver:resolveConfigImports}:{}),
    ...(id==='spring-properties/6'?{mountResolver:resolveMountedConfig}:{}),
    ...(id==='spring-properties/7'?{mountResolver:(...args)=>resolveMountedConfig(...args,{imports:true})}:{}),
  });
  else if (id === "spring-properties/1")
    result = resolveProperties(
      context.files,
      context.env,
      context.resources,
      context.source,
      context.ledger,
    );
  else if (id === "helm-template/1") {
    for (const file of context.chartFiles ?? []) {
      if (file.endsWith(".tgz"))
        throw Error("Binary chart archives are unsupported");
      if (
        /\b(lookup|now|randAlphaNum|randAlpha|randNumeric|randAscii|uuidv4|genCA|genSelfSignedCert|genSignedCert)\b/.test(
          context.files.get(file),
        )
      )
        throw Error(`Unsupported Helm context/random function in ${file}`);
    }
    result = renderHelm(
      context.root,
      context.config,
      context.env,
      context.ledger,
      { binary: context.binary },
    );
  } else throw Error(`Unsupported adapter: ${id}`);
  return validateAdapterResult(id, result);
}
