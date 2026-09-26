const normalize = (v) => JSON.stringify(v);
const images = (items) => [...items].map((c) => `${c.name}: ${c.image}`).sort();
const state = (f) => f ? {
  instance: f.instanceId, uid: f.uid, presence: f.presence,
  baselineImages: images(f.baselineImages), workloadImages: images(f.workloadImages),
  podImages: [...new Set(f.pods.flatMap((p) => images(p.containers)))].sort(),
  podCount: f.pods.length, replicas: f.replicas,
  rollout: f.rollout, availability: f.availability, classification: f.classification,
  acquisition: f.acquisition, podCoverage: f.podCoverage, freshness: f.freshness,
  consistency: f.consistency?.status ?? "unknown",
} : null;

// Compare captured facts only. Missing findings are not proof of deletion.
export function compareRuntime(before, after) {
  if (before.environment !== after.environment || before.cluster !== after.cluster ||
    before.simulation !== after.simulation) throw Error("Choose captures from the same environment, cluster and input mode.");
  const left = new Map(before.findings.map((f) => [f.resourceKey, f]));
  const right = new Map(after.findings.map((f) => [f.resourceKey, f]));
  return [...new Set([...left.keys(), ...right.keys()])].sort().map((key) => {
    const a = state(left.get(key)), b = state(right.get(key));
    return { key, before: a, after: b,
      identity: a && b && a.uid !== null && b.uid !== null && a.uid !== b.uid ? "recreated"
        : a?.uid && b?.uid ? "same-uid" : "unverified",
      changes: a && b ? Object.keys(a).filter((k) => normalize(a[k]) !== normalize(b[k])) : ["finding-coverage"],
      coverage: !a ? "not-in-before-report" : !b ? "not-in-after-report" : "both-reports",
    };
  });
}
