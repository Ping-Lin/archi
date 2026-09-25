import { hash } from "../analysis/contract.mjs";
import { workloadKey } from "../analysis/bindings.mjs";
import { insist, timestamp, validateSnapshot } from "../traffic/validation.mjs";
import { validateCapture, seal, RULE_VERSION } from "./contract.mjs";

const condition = (r, type) => r.conditions.find((c) => c.type === type);
const refs = (containers) =>
  containers
    .map((c) => ({ name: c.name, image: c.image }))
    .sort((a, b) => a.name.localeCompare(b.name));

export function reconcileRuntime(
  snapshot,
  capture,
  { assessedAt, ttlSeconds = 300 } = {},
) {
  validateSnapshot(snapshot);
  validateCapture(capture);
  insist(
    snapshot.environment === capture.environment,
    "runtime environment mismatch",
  );
  insist(
    snapshot.instances.some((i) => i.scope.cluster === capture.cluster),
    "cluster not bound in selected architecture",
  );
  insist(
    Array.isArray(snapshot.resources),
    "rendered resource inventory required",
  );
  const now = timestamp(assessedAt);
  insist(
    Number.isSafeInteger(ttlSeconds) && ttlSeconds > 0 && ttlSeconds <= 86400,
    "invalid runtime TTL",
  );
  const evidence = [],
    findings = [],
    used = new Set(),
    evidenceSeen = new Set();
  const ownerKey = (namespace, kind, uid) =>
    JSON.stringify([namespace, kind, uid]);
  const children = new Map(),
    deploymentIndex = new Map();
  for (const c of capture.collections)
    for (const r of c.resources) {
      if (r.kind === "Deployment")
        deploymentIndex.set(JSON.stringify([r.namespace, r.name]), r);
      const owner = r.owners.find((o) => o.controller);
      if (!owner) continue;
      const key = ownerKey(r.namespace, owner.kind, owner.uid);
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(r);
    }
  const baselineIndex = new Map(snapshot.resources.map((r) => [r.key, r]));
  const evidenceFor = (collection, resource = null) => {
    const item = {
      captureHash: capture.contentHash,
      namespace: collection.namespace,
      kind: collection.kind,
      collectionStatus: collection.status,
      collectionReason: collection.reason,
      resourceVersion: collection.resourceVersion,
      objectResourceVersion: resource?.resourceVersion ?? null,
      startedAt: collection.startedAt,
      finishedAt: collection.finishedAt,
      uid: resource?.uid ?? null,
      name: resource?.name ?? null,
    };
    const id = `runtime:${hash(item).slice(0, 24)}`;
    if (!evidenceSeen.has(id)) {
      evidence.push({ id, ...item });
      evidenceSeen.add(id);
    }
    return id;
  };
  const scope = (namespace, kind) =>
    capture.collections.find(
      (c) => c.namespace === namespace && c.kind === kind,
    );
  const freshnessFor = (c) =>
    !c || timestamp(c.finishedAt) > now
      ? "unknown"
      : now - timestamp(c.startedAt) > ttlSeconds * 1000
        ? "stale"
        : "fresh";
  const base = (id, namespace, name, key) => ({
    instanceId: id,
    cluster: capture.cluster,
    namespace,
    workload: name,
    resourceKey: key,
    uid: null,
    presence: "unknown",
    specAlignment: "unknown",
    rollout: "unknown",
    availability: "unknown",
    freshness: "unknown",
    acquisition: "failed",
    baselineImages: [],
    workloadImages: [],
    pods: [],
    podCoverage: "unknown",
    imageIdentity: "unverified",
    replicas: null,
    classification: "information",
    reportedFailures: [],
    consistency: { status: "unknown", checks: [] },
    reasonCodes: [],
    evidenceIds: [],
    baselineEvidenceIds: [],
  });
  function inspect(f, deployment, collection) {
    f.uid = deployment.uid;
    f.presence = "present";
    f.evidenceIds.push(evidenceFor(collection, deployment));
    f.workloadImages = refs(deployment.containers);
    if (f.baselineImages.length && f.workloadImages.length)
      f.specAlignment =
        hash(f.baselineImages) === hash(f.workloadImages)
          ? "matching"
          : "different";
    f.reasonCodes.push(
      f.specAlignment === "matching"
        ? "image-references-match-only"
        : f.specAlignment === "different"
          ? "baseline-spec-image-difference"
          : "baseline-comparison-unavailable",
    );
    f.replicas = {
      desired: deployment.replicas,
      ready: deployment.readyReplicas,
      available: deployment.availableReplicas,
      updated: deployment.updatedReplicas,
      total: deployment.currentReplicas,
    };
    const current =
      deployment.generation !== null &&
      deployment.observedGeneration !== null &&
      deployment.observedGeneration >= deployment.generation;
    // Conditions describe the captured generation, never a Helm root cause.
    if (current && !deployment.terminating) {
      for (const c of deployment.conditions) {
        if (
          (c.type === "Progressing" && c.status === "False" &&
            c.reason === "ProgressDeadlineExceeded") ||
          (c.type === "ReplicaFailure" && c.status === "True")
        ) f.reportedFailures.push({
          ...c, evidenceId: evidenceFor(collection, deployment),
        });
      }
      if (f.reportedFailures.length) f.classification = "reported-failure";
    }
    if (deployment.terminating) f.reasonCodes.push("deployment-terminating");
    else if (!current) f.reasonCodes.push("controller-generation-unobserved");
    else if (deployment.replicas === 0) {
      f.availability = "scaled-to-zero";
      f.reasonCodes.push("zero-desired-replicas");
    } else if (
      deployment.replicas !== null &&
      deployment.availableReplicas !== null
    ) {
      f.availability =
        deployment.availableReplicas >= deployment.replicas
          ? "available"
          : deployment.availableReplicas === 0
            ? "unavailable"
            : "degraded";
      f.reasonCodes.push("controller-availability-counts");
    }
    if (deployment.paused) {
      f.rollout = "paused";
      f.reasonCodes.push("rollout-paused");
    } else if (current && !deployment.terminating && deployment.replicas > 0) {
      const progressing = condition(deployment, "Progressing");
      if (progressing?.status === "False")
        f.reasonCodes.push("rollout-progress-failed");
      else if (
        deployment.updatedReplicas === deployment.replicas &&
        deployment.currentReplicas === deployment.replicas &&
        deployment.availableReplicas === deployment.replicas
      ) {
        f.rollout = "complete";
        f.reasonCodes.push("controller-rollout-complete");
      } else if (progressing?.status === "True") {
        f.rollout = "progressing";
        f.reasonCodes.push("controller-rollout-progressing");
      }
    }
    const rsCollection = scope(f.namespace, "ReplicaSet"),
      podCollection = scope(f.namespace, "Pod");
    const related = [collection, rsCollection, podCollection];
    f.acquisition = related.every((c) => c?.status === "complete")
      ? "complete"
      : "partial";
    const fresh = related.map(freshnessFor);
    f.freshness = fresh.includes("unknown")
      ? "unknown"
      : fresh.includes("stale")
        ? "stale"
        : "fresh";
    const replicasets = (
      children.get(ownerKey(f.namespace, "Deployment", deployment.uid)) ?? []
    ).filter((r) => r.kind === "ReplicaSet");
    const pods = replicasets.flatMap((r) =>
      (children.get(ownerKey(f.namespace, "ReplicaSet", r.uid)) ?? []).filter(
        (p) => p.kind === "Pod",
      ),
    );
    for (const c of [rsCollection, podCollection])
      if (c) f.evidenceIds.push(evidenceFor(c));
    for (const r of replicasets)
      f.evidenceIds.push(evidenceFor(rsCollection, r));
    for (const p of pods) {
      f.evidenceIds.push(evidenceFor(podCollection, p));
      f.pods.push({
        name: p.name,
        uid: p.uid,
        terminating: p.terminating,
        ready: condition(p, "Ready")?.status ?? "Unknown",
        containers: refs(p.containers),
        containerStatuses: p.containerStatuses,
      });
    }
    f.podCoverage =
      rsCollection?.status === "complete" &&
      podCollection?.status === "complete"
        ? "complete"
        : "partial";
    // Separate API lists are not atomic. Discrepancies request verification;
    // they neither invalidate the capture nor establish deployment failure.
    if (f.acquisition === "complete" && current && !deployment.terminating) {
      const check = (code, reported, observed, resources) => {
        if (reported === null) return;
        f.consistency.checks.push({
          code, reported, observed,
          status: reported === observed ? "consistent" : "needs-verification",
          evidenceIds: resources.map(([c, r]) => evidenceFor(c, r)),
        });
      };
      const activePods = pods.filter((p) => !p.terminating);
      check("deployment-pod-count", deployment.currentReplicas, activePods.length,
        [[collection, deployment], [rsCollection, null], [podCollection, null]]);
      for (const rs of replicasets.filter((r) => !r.terminating &&
        r.observedGeneration !== null && r.generation !== null &&
        r.observedGeneration >= r.generation)) {
        const owned = (children.get(ownerKey(f.namespace, "ReplicaSet", rs.uid)) ?? [])
          .filter((p) => p.kind === "Pod" && !p.terminating);
        check("replicaset-pod-count", rs.currentReplicas, owned.length,
          [[rsCollection, rs], [podCollection, null]]);
      }
      const discrepant = f.consistency.checks.some((c) => c.status === "needs-verification");
      f.consistency.status = discrepant ? "needs-verification"
        : f.consistency.checks.length ? "no-discrepancy-detected" : "unknown";
      if (discrepant && !f.reportedFailures.length)
        f.classification = "needs-verification";
    }
    const versions = new Map();
    for (const p of pods)
      for (const c of p.containers) {
        if (!versions.has(c.name)) versions.set(c.name, new Set());
        versions.get(c.name).add(c.image);
      }
    if ([...versions.values()].some((v) => v.size > 1))
      f.reasonCodes.push("mixed-pod-image-references");
    if (pods.some((p) => hash(refs(p.containers)) !== hash(f.workloadImages)))
      f.reasonCodes.push("pod-spec-image-difference");
    if (!pods.length) f.reasonCodes.push("no-owned-pods-in-capture");
    f.reasonCodes.push(
      "pod-image-ids-not-equivalence-proof",
      "collection-is-not-atomic",
    );
  }
  for (const i of snapshot.instances) {
    if (i.scope.cluster !== capture.cluster) continue; // Other clusters are not queried by this capture.
    const key = workloadKey(i, i.scope),
      f = base(i.id, i.scope.namespace, i.workload, key);
    const baseline = baselineIndex.get(key);
    if (baseline) {
      f.baselineImages = refs(baseline.spec?.template?.spec?.containers ?? []);
      if (baseline.evidenceId) f.baselineEvidenceIds.push(baseline.evidenceId);
    }
    const c = scope(i.scope.namespace, "Deployment");
    if (!c) f.reasonCodes.push("namespace-not-collected");
    else {
      f.acquisition = c.status;
      f.freshness = freshnessFor(c);
      f.evidenceIds.push(evidenceFor(c));
      const deployment = deploymentIndex.get(
        JSON.stringify([i.scope.namespace, i.workload]),
      );
      if (deployment) {
        used.add(deployment.uid);
        inspect(f, deployment, c);
      } else if (c.status === "complete") {
        f.presence = "absent";
        f.reasonCodes.push("absent-in-complete-namespace-list");
      } else f.reasonCodes.push("incomplete-list-cannot-establish-absence");
    }
    findings.push(f);
  }
  for (const c of capture.collections.filter((c) => c.kind === "Deployment"))
    for (const d of c.resources) {
      if (used.has(d.uid)) continue;
      const f = base(
        null,
        c.namespace,
        d.name,
        [capture.cluster, "apps", "deployments", c.namespace, d.name].join("|"),
      );
      inspect(f, d, c);
      f.reasonCodes.push("unbound-runtime-workload");
      findings.push(f);
    }
  return seal({
    schemaVersion: "archi/runtime-report-v1alpha1",
    ruleVersion: RULE_VERSION,
    environment: capture.environment,
    cluster: capture.cluster,
    simulation: capture.simulation,
    staticContentHash: snapshot.contentHash,
    captureHash: capture.contentHash,
    assessedAt,
    ttlSeconds,
    startedAt: capture.startedAt,
    finishedAt: capture.finishedAt,
    releaseCorrespondence: "unverified",
    clusterIdentity: capture.clusterIdentity,
    findings,
    evidence,
  });
}
