import Ajv from "ajv";

export const SYSTEM_VERSION = "archi/system-v1alpha1";
const text = { type: "string", minLength: 1 };
const id = { ...text, pattern: "^[a-z][a-z0-9.-]*$" };
const dnsLabel = {...text,maxLength:63,pattern:'^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'};
const list = (items) => ({ type: "array", items });
const object = (properties) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const unique = (items) => ({ ...list(items), uniqueItems: true });
export const fileRef = object({ repository: id, path: text });
export const bindingSchema = object({
  id,
  service: id,
  release: id,
  workload: {...dnsLabel,maxLength:253,pattern:'^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'},
  endpoint: {
    anyOf: [
      { type: "null" },
      object({
        name: dnsLabel,
        port: { type: "integer", minimum: 1, maximum: 65535 },
        protocol: { enum: ["HTTP", "HTTPS", "TCP"] },
        kind: { enum: ["service", "gateway"] },
      }),
    ],
  },
  profiles: unique(text),
  propertyFiles: list(fileRef),
  propertiesComplete: { type: "boolean" },
});
export const systemSchema = object({
  schemaVersion: { const: SYSTEM_VERSION },
  simulation: { type: "boolean" },
  name: text,
  repositories: {
    ...list(
      object({
        id,
        path: text,
        revision: { type: "string", pattern: "^[0-9a-f]{40}$" },
      }),
    ),
    minItems: 1,
  },
  projects: { ...list(object({ id, name: text })), minItems: 1 },
  services: {
    ...list(
      object({
        id,
        project: id,
        source: {oneOf:[object({
          adapter: { const: "spring-explicit-bean/1" },
          files: { ...list(fileRef), minItems: 1 },
          clientTypes: { ...unique(text), minItems: 1 },
        }),object({
        adapter:{const:'ai-evidence/1'},
        files:{...list(fileRef),minItems:1},
        candidateFile:fileRef,
        reviews:list(object({candidateHash:{type:'string',pattern:'^[a-f0-9]{64}$'},environment:id,instance:id,
          decision:{enum:['accepted','rejected']},reviewer:text,reason:text})),
        })]},
      }),
    ),
    minItems: 1,
  },
  environments: {
    ...list(
      object({
        id,
        releases: {
          ...list(
            object({
              id,
              cluster: id,
              namespace: dnsLabel,
              name: {...dnsLabel,maxLength:53},
              adapter: { const: "helm-template/1" },
              chart: fileRef,
              values: list(fileRef),
              helmVersion: { const: "v3.17.3" },
              kubeVersion: text,
              apiVersions: unique(text),
            }),
          ),
          minItems: 1,
        },
        instances: { ...list(bindingSchema), minItems: 1 },
        externalTargets: list(object({ id, url: text })),
      }),
    ),
    minItems: 1,
  },
});
const validate = new Ajv({ allErrors: true }).compile(systemSchema);
function ids(items, scope) {
  const values = items.map((i) => i.id);
  if (new Set(values).size !== values.length)
    throw Error(`Duplicate ${scope} identity`);
  return new Set(values);
}
export function safeRepoPath(value) {
  if (
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some((s) => !s || s === "." || s === "..") ||
    /^[A-Za-z]:/.test(value)
  )
    throw Error(`Unsafe repository-relative path: ${value}`);
  return value;
}
export function validateSystem(manifest) {
  if (!validate(manifest))
    throw Error(`Invalid system manifest: ${JSON.stringify(validate.errors)}`);
  const repos = ids(manifest.repositories, "repository"),
    projects = ids(manifest.projects, "project"),
    services = ids(manifest.services, "service");
  ids(manifest.environments, "environment");
  const file = (ref) => {
    if (!repos.has(ref.repository))
      throw Error(`Unknown repository: ${ref.repository}`);
    safeRepoPath(ref.path);
  };
  for (const s of manifest.services) {
    if (!projects.has(s.project)) throw Error(`Unknown project: ${s.project}`);
    s.source.files.forEach(file);
    if(s.source.adapter==='ai-evidence/1') {
      file(s.source.candidateFile);
      const scopes=new Set();
      for(const r of s.source.reviews){
        const env=manifest.environments.find(e=>e.id===r.environment);
        if(!env?.instances.some(i=>i.id===r.instance&&i.service===s.id))throw Error('AI review scope does not belong to service');
        const key=JSON.stringify([r.candidateHash,r.environment,r.instance]);
        if(scopes.has(key))throw Error('Duplicate AI review scope');scopes.add(key);
      }
    }
  }
  for (const env of manifest.environments) {
    const releases = ids(env.releases, "release"),
      instances = ids(env.instances, "instance"),
      external = ids(env.externalTargets, "external target");
    const contexts = new Set(),
      workloads = new Set();
    for (const r of env.releases) {
      const key = JSON.stringify([r.cluster, r.namespace, r.name]);
      if (contexts.has(key)) throw Error("Duplicate release deployment scope");
      contexts.add(key);
      file(r.chart);
      r.values.forEach(file);
    }
    for (const i of env.instances) {
      if (!services.has(i.service) || !releases.has(i.release))
        throw Error(`Unknown service or release for ${i.id}`);
      const key = JSON.stringify([i.release, i.workload]);
      if (workloads.has(key))
        throw Error("Workload bound to multiple instances");
      workloads.add(key);
      i.propertyFiles.forEach(file);
    }
    for (const t of env.externalTargets) {
      if (instances.has(t.id))
        throw Error("External and instance identities collide");
      const url = new URL(t.url);
      if (
        !["http:", "https:", "tcp:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw Error(`Unsupported external endpoint: ${t.id}`);
    }
  }
  return manifest;
}
