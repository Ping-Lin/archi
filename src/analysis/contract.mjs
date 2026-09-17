import { createHash } from "node:crypto";
import Ajv from "ajv";

export const VERSION = "archi/analysis-v2alpha1";
export const RULE_VERSION = "spring-explicit-bean/1";
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
export const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" ? value : JSON.stringify(canonical(value)),
    )
    .digest("hex");
export const identify = (type, value) => `${type}:${hash(value).slice(0, 24)}`;
const string = { type: "string", minLength: 1 };
const strings = { type: "array", items: string, uniqueItems: true };
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const sourceSchema = object({
  service: string,
  files: { ...strings, minItems: 1 },
  clientTypes: { ...strings, minItems: 1 },
});
const callerProperties = {
  profiles: strings,
  propertyFiles: strings,
  propertiesComplete: { type: "boolean" },
  observations: { type: ["string", "null"] },
};
const environmentProperties = {
  id: string,
  namespace: string,
  cluster: string,
  release: string,
  values: strings,
  targets: {
    type: "array",
    items: object({
      id: string,
      url: string,
      kind: { enum: ["gateway", "external", "service"] },
    }),
  },
};
const commonConfig = {
  schemaVersion: { const: VERSION },
  simulation: { const: true },
  name: string,
  helm: object({
    chart: string,
    version: { const: "v3.17.3" },
    kubeVersion: string,
    apiVersions: strings,
  }),
};
export const configSchema = {
  oneOf: [
    object({
      ...commonConfig,
      source: sourceSchema,
      environments: {
        type: "array",
        minItems: 1,
        items: object({ ...environmentProperties, ...callerProperties }),
      },
    }),
    object({
      ...commonConfig,
      sources: { type: "array", minItems: 2, items: sourceSchema },
      environments: {
        type: "array",
        minItems: 1,
        items: object({
          ...environmentProperties,
          callers: {
            type: "array",
            minItems: 2,
            items: object({ service: string, ...callerProperties }),
          },
        }),
      },
    }),
  ],
};
export const sourcesFor = (config) => config.sources ?? [config.source];
export const callersFor = (config, env) =>
  sourcesFor(config).map((source) => ({
    source,
    env: env.callers
      ? { ...env, ...env.callers.find((c) => c.service === source.service) }
      : env,
  }));
const validate = new Ajv({ allErrors: true }).compile(configSchema);
export function validateConfig(config) {
  if (!validate(config))
    throw new Error(
      `Invalid analysis configuration: ${JSON.stringify(validate.errors)}`,
    );
  if (
    new Set(config.environments.map((e) => e.id)).size !==
    config.environments.length
  )
    throw new Error("Duplicate environment ID");
  for (const env of config.environments) {
    if (config.sources) {
      const services = config.sources.map((s) => s.service);
      const callers = env.callers.map((c) => c.service);
      if (new Set(services).size !== services.length)
        throw new Error("Duplicate source service");
      if (
        new Set(callers).size !== callers.length ||
        callers.length !== services.length ||
        services.some((s) => !callers.includes(s))
      )
        throw new Error(
          `Caller scopes must match sources exactly in ${env.id}`,
        );
      const observationFiles = env.callers
        .map((c) => c.observations)
        .filter(Boolean);
      if (new Set(observationFiles).size !== observationFiles.length)
        throw new Error(`Observation files must be caller-scoped in ${env.id}`);
      if (
        env.targets.some(
          (t) => services.includes(t.id) && t.kind === "external",
        )
      )
        throw new Error(
          `Analyzed caller cannot also be an external target in ${env.id}`,
        );
    }
    if (new Set(env.targets.map((t) => t.id)).size !== env.targets.length)
      throw new Error(`Duplicate target ID in ${env.id}`);
    for (const target of env.targets) {
      const url = new URL(target.url);
      if (
        !["http:", "https:", "tcp:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error(`Unsupported or sensitive target URL: ${target.id}`);
    }
  }
  return config;
}

export function createLedger(environment, caller = null) {
  const evidence = [],
    facts = [],
    resolutions = [];
  function add(collection, type, payload) {
    const record = {
      id: identify(type, {
        environment,
        ...(caller ? { caller } : {}),
        ...payload,
      }),
      environment,
      ...(caller ? { caller } : {}),
      ...payload,
    };
    if (!collection.some((r) => r.id === record.id)) collection.push(record);
    return record.id;
  }
  return {
    evidence,
    facts,
    resolutions,
    recordEvidence: (payload) => add(evidence, "evidence", payload),
    fact: (predicate, subject, value, evidenceIds) =>
      add(facts, "fact", { predicate, subject, value, evidenceIds }),
    resolve: (rule, inputFactIds, outcome, reasons) =>
      add(resolutions, "resolution", {
        rule,
        version: RULE_VERSION,
        inputFactIds,
        outcome,
        reasons,
      }),
  };
}

export function assertSnapshot(snapshot) {
  if (snapshot.schemaVersion !== VERSION)
    throw new Error("Unsupported snapshot version");
  const all = [
    ...snapshot.evidence,
    ...snapshot.facts,
    ...snapshot.resolutions,
  ];
  const ids = new Set(all.map((x) => x.id));
  if (ids.size !== all.length) throw new Error("Duplicate ledger ID");
  const evidence = new Set(snapshot.evidence.map((x) => x.id)),
    facts = new Set(snapshot.facts.map((x) => x.id)),
    resolutions = new Set(snapshot.resolutions.map((x) => x.id));
  for (const item of all)
    if (item.environment !== snapshot.environment)
      throw new Error("Cross-environment evidence");
  for (const fact of snapshot.facts)
    if (
      !fact.evidenceIds.length ||
      fact.evidenceIds.some((id) => !evidence.has(id))
    )
      throw new Error("Dangling fact evidence");
  for (const resolution of snapshot.resolutions)
    if (
      !resolution.inputFactIds.length ||
      resolution.inputFactIds.some((id) => !facts.has(id))
    )
      throw new Error("Dangling resolution fact");
  for (const candidate of snapshot.candidates)
    if (!resolutions.has(candidate.resolutionId))
      throw new Error("Missing candidate explanation");
  if (
    new Set(snapshot.candidates.map((c) => c.id)).size !==
    snapshot.candidates.length
  )
    throw new Error("Duplicate candidate ID");
  for (const candidate of snapshot.candidates) {
    const resolution = snapshot.resolutions.find(
      (r) => r.id === candidate.resolutionId,
    );
    if (resolution.caller && resolution.caller !== candidate.source)
      throw new Error("Cross-caller resolution");
    if (
      resolution.caller &&
      resolution.inputFactIds.some((id) => {
        const fact = snapshot.facts.find((f) => f.id === id);
        return fact.caller && fact.caller !== resolution.caller;
      })
    )
      throw new Error("Cross-caller facts");
  }
  for (const edge of snapshot.dependencies)
    if (
      !resolutions.has(edge.resolutionId) ||
      edge.environment !== snapshot.environment
    )
      throw new Error("Unexplained dependency");
  return snapshot;
}
