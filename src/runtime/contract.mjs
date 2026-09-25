import Ajv from "ajv";
import { hash } from "../analysis/contract.mjs";
import {
  boundedJson,
  insist,
  LIMITS,
  timestamp,
  verifyHash,
} from "../traffic/validation.mjs";

export const CAPTURE_VERSION = "archi/runtime-capture-v1alpha1";
export const RULE_VERSION = "deployment-runtime/1";
export const KINDS = ["Deployment", "ReplicaSet", "Pod"];
const text = { type: "string", minLength: 1, maxLength: 1024 };
const nullableText = { anyOf: [text, { type: "null" }] };
const number = {
  type: ["integer", "null"],
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
};
const object = (properties) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const list = (items) => ({ type: "array", items, maxItems: LIMITS.records });
export const resourceSchema = object({
  kind: { enum: KINDS },
  name: text,
  namespace: text,
  uid: text,
  resourceVersion: text,
  generation: number,
  observedGeneration: number,
  replicas: number,
  readyReplicas: number,
  availableReplicas: number,
  updatedReplicas: number,
  currentReplicas: number,
  paused: { type: "boolean" },
  terminating: { type: "boolean" },
  owners: list(
    object({ kind: text, uid: text, controller: { type: "boolean" } }),
  ),
  containers: list(object({ name: text, image: text })),
  containerStatuses: list(
    object({
      name: text,
      image: nullableText,
      imageID: nullableText,
      ready: { type: "boolean" },
    }),
  ),
  conditions: list(
    object({
      type: text,
      status: { enum: ["True", "False", "Unknown"] },
      reason: nullableText,
    }),
  ),
});
const collectionSchema = object({
  namespace: text,
  kind: { enum: KINDS },
  selector: { const: null }, // No filters in v1: namespace-scoped list coverage is explicit.
  status: { enum: ["complete", "partial", "failed"] },
  reason: {
    enum: [
      null,
      "query-failed",
      "invalid-response",
      "collection-limit",
      "deadline-exceeded",
    ],
  },
  startedAt: text,
  finishedAt: text,
  resourceVersion: nullableText,
  resources: list(resourceSchema),
});
export const captureSchema = object({
  schemaVersion: { const: CAPTURE_VERSION },
  simulation: { type: "boolean" },
  environment: text,
  cluster: text,
  context: text,
  clusterIdentity: { const: "operator-asserted" },
  startedAt: text,
  finishedAt: text,
  adapter: { const: "kubernetes-inventory/1" },
  collections: { ...list(collectionSchema), minItems: 1, maxItems: 48 },
  contentHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
});
const validate = new Ajv().compile(captureSchema);
export function seal(value) {
  const { contentHash, ...body } = value;
  return { ...body, contentHash: hash(body) };
}
export function validateCapture(capture) {
  boundedJson(capture);
  insist(validate(capture), "invalid runtime capture structure");
  verifyHash(capture, "runtime capture");
  const start = timestamp(capture.startedAt),
    end = timestamp(capture.finishedAt);
  insist(start <= end, "negative capture interval");
  const scopes = new Set(),
    uids = new Set();
  let count = 0;
  for (const c of capture.collections) {
    const key = JSON.stringify([c.namespace, c.kind]);
    insist(!scopes.has(key), "duplicate collection scope");
    scopes.add(key);
    insist(
      timestamp(c.startedAt) >= start &&
        timestamp(c.finishedAt) <= end &&
        timestamp(c.startedAt) <= timestamp(c.finishedAt),
      "collection interval outside capture",
    );
    insist(
      c.status === "complete"
        ? c.reason === null && c.resourceVersion !== null
        : c.reason !== null,
      "invalid collection outcome",
    );
    insist(
      c.status !== "failed" || c.resources.length === 0,
      "failed collection has records",
    );
    const names = new Set();
    for (const r of c.resources) {
      insist(++count <= LIMITS.records, "runtime record limit exceeded");
      insist(
        r.namespace === c.namespace && r.kind === c.kind,
        "resource outside collection scope",
      );
      insist(
        !names.has(r.name) && !uids.has(r.uid),
        "duplicate resource identity",
      );
      names.add(r.name);
      uids.add(r.uid);
      for (const field of ["containers", "containerStatuses"])
        insist(
          new Set(r[field].map((x) => x.name)).size === r[field].length,
          "duplicate container name",
        );
      insist(
        new Set(r.conditions.map((x) => x.type)).size === r.conditions.length,
        "duplicate condition type",
      );
      insist(
        r.owners.filter((x) => x.controller).length <= 1,
        "ambiguous controller owner",
      );
    }
  }
  return capture;
}

// Persist an allowlisted projection only. No env, command, args, labels,
// annotations, status messages, credentials or full kubeconfig are retained.
export function projectResource(raw, kind, namespace) {
  insist(
    raw?.kind === kind && raw.metadata?.namespace === namespace,
    "unexpected API resource",
  );
  const m = raw.metadata,
    s = raw.spec ?? {},
    status = raw.status ?? {};
  const podSpec = kind === "Pod" ? s : (s.template?.spec ?? {});
  const r = {
    kind,
    name: m.name,
    namespace,
    uid: m.uid,
    resourceVersion: m.resourceVersion,
    generation: m.generation ?? null,
    observedGeneration: status.observedGeneration ?? null,
    replicas: s.replicas ?? null,
    readyReplicas: status.readyReplicas ?? null,
    availableReplicas: status.availableReplicas ?? null,
    updatedReplicas: status.updatedReplicas ?? null,
    currentReplicas: status.replicas ?? null,
    paused: s.paused === true,
    terminating: !!m.deletionTimestamp,
    owners: (m.ownerReferences ?? []).map((o) => ({
      kind: o.kind,
      uid: o.uid,
      controller: o.controller === true,
    })),
    containers: (podSpec.containers ?? []).map((c) => ({
      name: c.name,
      image: c.image,
    })),
    containerStatuses: (status.containerStatuses ?? []).map((c) => ({
      name: c.name,
      image: c.image ?? null,
      imageID: c.imageID ?? null,
      ready: c.ready === true,
    })),
    conditions: (status.conditions ?? []).map((c) => ({
      type: c.type,
      status: c.status,
      reason: c.reason ?? null,
    })),
  };
  // Full validation, including duplicate checks, is performed on the capture.
  insist(validateResource(r), "invalid normalized resource");
  return r;
}
const validateResource = new Ajv().compile(resourceSchema);
