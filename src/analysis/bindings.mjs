import Ajv from "ajv";
import { hash } from "./contract.mjs";

export const resolutionContract = Object.freeze({
  id: "deployment-endpoint/1",
  inputs: [
    "effective-endpoint",
    "caller-deployment-scope",
    "instance-bindings",
    "rendered-resources",
  ],
  outcomes: ["unique", "ambiguous", "unresolved"],
});
const validateResult = new Ajv().compile({
  type: "object",
  additionalProperties: false,
  required: ["matches", "factIds", "reasons"],
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "url"],
        properties: {
          id: { type: "string" },
          kind: { enum: ["service", "gateway", "external"] },
          url: { type: "string" },
        },
      },
    },
    factIds: { type: "array", items: { type: "string" } },
    reasons: { type: "array", items: { type: "string" } },
  },
});
export const workloadKey = (instance, release) =>
  [
    release.cluster,
    "apps",
    "deployments",
    release.namespace,
    instance.workload,
  ].join("|");

export function deploymentResolver({ env, caller, resources, manifestHash }) {
  const releases = new Map(env.releases.map((r) => [r.id, r]));
  const callerRelease = releases.get(caller.release);
  return (url, ledger) => {
    const evidence = ledger.recordEvidence({
      type: "declared_system_bindings",
      locator: `system.manifest/environments/${env.id}`,
      contentHash: hash({ manifestHash, env }),
      manifestHash,
    });
    const factIds = [
      ledger.fact(
        "system.bindings",
        env.id,
        {
          instances: env.instances,
          releases: env.releases,
          externalTargets: env.externalTargets,
        },
        [evidence],
      ),
    ];
    const matches = [],
      reasons = [];
    if (url) {
      const parsed = new URL(url),
        port =
          Number(parsed.port) ||
          (parsed.protocol === "https:"
            ? 443
            : parsed.protocol === "http:"
              ? 80
              : 0);
      for (const instance of env.instances) {
        const release = releases.get(instance.release),
          endpoint = instance.endpoint;
        if (
          !endpoint ||
          release.cluster !== callerRelease.cluster ||
          endpoint.port !== port ||
          endpoint.protocol.toLowerCase() + ":" !== parsed.protocol
        )
          continue;
        const hosts = [
          `${endpoint.name}.${release.namespace}`,
          `${endpoint.name}.${release.namespace}.svc`,
          `${endpoint.name}.${release.namespace}.svc.cluster.local`,
        ];
        if (release.namespace === callerRelease.namespace)
          hosts.push(endpoint.name);
        if (!hosts.includes(parsed.hostname)) continue;
        const svc = resources.find(
          (r) =>
            r.releaseId === release.id &&
            r.kind === "Service" &&
            r.name === endpoint.name &&
            r.namespace === release.namespace,
        );
        const deployment = resources.find(
          (r) =>
            r.releaseId === release.id &&
            r.key === workloadKey(instance, release),
        );
        const selector = svc?.spec?.selector,
          labels = deployment?.spec?.template?.metadata?.labels ?? {};
        if (svc) factIds.push(svc.factId);
        if (deployment) factIds.push(deployment.factId);
        if (
          !svc ||
          !deployment ||
          !svc.spec?.ports?.some((p) => p.port === port && (p.protocol??'TCP')==='TCP') ||
          !selector ||
          !Object.keys(selector).length ||
          !Object.entries(selector).every(([k, v]) => labels[k] === v)
        ) {
          reasons.push(
            `Binding ${instance.id} lacks matching Service/port/workload selector evidence`,
          );
          continue;
        }
        matches.push({ id: instance.id, kind: endpoint.kind, url });
      }
      for (const target of env.externalTargets)
        if (new URL(target.url).href.replace(/\/$/, "") === url)
          matches.push({ id: target.id, kind: "external", url });
    }
    const result = { matches, factIds: [...new Set(factIds)], reasons };
    if (!validateResult(result))
      throw Error("Invalid deployment resolution result");
    return result;
  };
}
