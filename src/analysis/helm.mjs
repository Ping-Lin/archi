import { spawnSync } from "node:child_process";
import { parseAllDocuments, stringify } from "yaml";
import { hash, identify } from "./contract.mjs";

const resourceTypes = {
  "apps/Deployment": "deployments",
  "/Service": "services",
  "/ConfigMap": "configmaps",
};
export function resourceKey(resource, env) {
  if (
    typeof resource?.apiVersion !== "string" ||
    typeof resource?.kind !== "string"
  )
    return null;
  const group = resource.apiVersion.includes("/")
    ? resource.apiVersion.split("/")[0]
    : "";
  const type = resourceTypes[`${group}/${resource.kind}`];
  if (!type || !resource.metadata?.name) return null;
  return [
    env.cluster,
    group,
    type,
    resource.metadata.namespace ?? env.namespace,
    resource.metadata.name,
  ].join("|");
}
export function parseManifest(
  text,
  env,
  ledger,
  { origin = "helm_render", locator = "helm:rendered" } = {},
) {
  const resources = [],
    diagnostics = [],
    documents = parseAllDocuments(text, { uniqueKeys: true });
  if (documents.some((d) => d.errors.length))
    throw new Error(
      "Invalid rendered YAML: " +
        documents.flatMap((d) => d.errors.map((e) => e.message)).join("; "),
    );
  const evidenceId = ledger.recordEvidence({
    type: origin,
    locator,
    contentHash: hash(text),
  });
  for (const [index, doc] of documents.entries()) {
    const value = doc.toJS({ maxAliasCount: 100 });
    if (!value) continue;
    const key = resourceKey(value, env);
    if (!key || value.metadata?.annotations?.["helm.sh/hook"]) {
      diagnostics.push({
        code: "UNSUPPORTED_RESOURCE",
        message: `Document ${index + 1}: ${value.kind ?? "unknown"} retained outside supported inventory`,
        document: index + 1,
      });
      continue;
    }
    if (resources.some((r) => r.key === key))
      throw new Error(`Duplicate rendered resource identity: ${key}`);
    const labels = value.metadata.labels ?? {};
    const resource = {
      id: identify("resource", { environment: env.id, key }),
      key,
      kind: value.kind,
      apiVersion: value.apiVersion,
      name: value.metadata.name,
      namespace: value.metadata.namespace ?? env.namespace,
      uid: value.metadata.uid ?? null,
      service: labels["app.kubernetes.io/name"] ?? null,
      instance: labels["app.kubernetes.io/instance"] ?? null,
      spec: value.spec ?? null,
      data: value.kind === "ConfigMap" ? (value.data ?? {}) : null,
      ...(value.kind==='ConfigMap'&&value.binaryData!==undefined?{hasBinaryData:true}:{}),
      evidenceId,
    };
    resource.factId = ledger.fact(
      "resource.present",
      key,
      { kind: resource.kind, name: resource.name, origin },
      [evidenceId],
    );
    resources.push(resource);
  }
  return { resources, diagnostics, evidenceId };
}

export function renderHelm(
  capturedRoot,
  config,
  env,
  ledger,
  { binary = process.env.HELM_BIN ?? "helm" } = {},
) {
  const run = (args) =>
    spawnSync(binary, args, {
      cwd: capturedRoot,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
    });
  const versionResult = run(["version", "--template", "{{.Version}}"]);
  if (versionResult.error || versionResult.status !== 0)
    throw new Error(
      "Helm v3.17.3 required; set HELM_BIN or install it on PATH",
    );
  const version = versionResult.stdout.trim();
  if (version !== config.helm.version)
    throw new Error(
      `Helm version mismatch: expected ${config.helm.version}, got ${version}`,
    );
  const args = [
    "template",
    env.release,
    config.helm.chart,
    "--namespace",
    env.namespace,
    "--kube-version",
    config.helm.kubeVersion,
    "--include-crds",
    ...config.helm.apiVersions.flatMap((v) => ["--api-versions", v]),
    ...env.values.flatMap((v) => ["--values", v]),
  ];
  const first = run(args),
    second = run(args);
  if (first.error || second.error || first.status !== 0 || second.status !== 0)
    throw new Error(
      `Helm render failed: ${first.error?.message ?? first.stderr ?? second.stderr}`,
    );
  if (first.stdout !== second.stdout)
    throw new Error("NONDETERMINISTIC_HELM: repeated renders differ");
  const parsed=parseManifest(first.stdout,env,ledger),manifest=redactSecretManifests(first.stdout);
  if(manifest!==first.stdout)parsed.diagnostics.push({code:'SECRET_EXPORT_REDACTED',message:'Standard Secret documents are exported as identities only; render hashes identify original bytes, not redacted exports'});
  return {
    ...parsed,
    version,
    outputHash: hash(first.stdout),
    manifest,
    coverage: {
      collector: "helm",
      status: "complete",
      scope: `${env.id}/${env.release}`,
      meaning: "Supported kinds in local render; no live inventory",
    },
  };
}

// Export identities only for standard Secrets, including nested Kubernetes Lists.
// This is not a general detector for credentials placed in other resource kinds.
export function redactSecretManifests(text) {
  const docs=parseAllDocuments(text,{uniqueKeys:true});
  if(docs.some(d=>d.errors.length))throw Error('Cannot export invalid rendered YAML');
  let changed=false;
  const redact=value=>{
    if(value?.apiVersion==='v1'&&value.kind==='Secret'){
      changed=true;
      return {apiVersion:'v1',kind:'Secret',metadata:{name:value.metadata?.name??null,namespace:value.metadata?.namespace??null},'archi.redacted':true};
    }
    if(value?.kind==='List'&&Array.isArray(value.items))return {...value,items:value.items.map(redact)};
    return value;
  };
  const values=docs.map(d=>redact(d.toJS({maxAliasCount:100})));
  return changed?values.map(v=>stringify(v)).join('---\n'):text;
}
