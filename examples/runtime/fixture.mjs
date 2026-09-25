import { seal, CAPTURE_VERSION } from "../../src/runtime/contract.mjs";
export const CAPTURE_AT = "2026-09-24T12:00:00.000Z";
export function specimen(
  kind,
  namespace,
  name,
  uid,
  image = "example.invalid/orders:previous",
  overrides = {},
) {
  return {
    kind,
    namespace,
    name,
    uid,
    resourceVersion: "100",
    generation: 2,
    observedGeneration: kind === "Pod" ? null : 2,
    replicas: kind === "Pod" ? null : 2,
    readyReplicas: kind === "Pod" ? null : 2,
    availableReplicas: kind === "Pod" ? null : 2,
    updatedReplicas: kind === "Deployment" ? 2 : null,
    currentReplicas: kind === "Pod" ? null : 2,
    paused: false,
    terminating: false,
    owners: [],
    containers: [{ name: "app", image }],
    containerStatuses: [],
    conditions: kind === "Deployment" ? [
      { type: "Progressing", status: "True", reason: "NewReplicaSetAvailable" },
    ] : [],
    ...overrides,
  };
}
export function runtimeFixture() {
  const collections = [];
  function collection(namespace, kind, resources, status = "complete") {
    collections.push({
      namespace,
      kind,
      selector: null,
      status,
      reason: status === "complete" ? null : "query-failed",
      startedAt: CAPTURE_AT,
      finishedAt: CAPTURE_AT,
      resourceVersion: status === "complete" ? "100" : null,
      resources,
    });
  }
  for (const [namespace, service] of [
    ["experience-qa", "portal"],
    ["sales-qa", "orders"],
  ]) {
    const d = specimen(
      "Deployment",
      namespace,
      "api",
      `${service}-deployment`,
      `example.invalid/${service}:${service === "orders" ? "previous" : "synthetic"}`,
    );
    if (service === "orders") {
      d.updatedReplicas = 1;
      d.currentReplicas = 3;
    }
    collection(namespace, "Deployment", [d]);
    const old = specimen(
      "ReplicaSet",
      namespace,
      "api-old",
      `${service}-rs-old`,
      service === "orders" ? "example.invalid/orders:older" : d.containers[0].image,
      { owners: [{ kind: "Deployment", uid: d.uid, controller: true }],
        replicas: service === "orders" ? 2 : 1,
        currentReplicas: service === "orders" ? 2 : 1,
        readyReplicas: service === "orders" ? 2 : 1,
        availableReplicas: service === "orders" ? 2 : 1 },
    );
    const next = specimen(
      "ReplicaSet",
      namespace,
      "api-next",
      `${service}-rs-next`,
      d.containers[0].image,
      { owners: old.owners, replicas: 1, currentReplicas: 1,
        readyReplicas: service === "orders" ? 0 : 1,
        availableReplicas: service === "orders" ? 0 : 1 },
    );
    collection(namespace, "ReplicaSet", [old, next]);
    const pod = (name, owner, image, ready = true) =>
      specimen("Pod", namespace, name, `${service}-${name}`, image, {
        owners: [{ kind: "ReplicaSet", uid: owner.uid, controller: true }],
        conditions: [{ type: "Ready", status: ready ? "True" : "False", reason: null }],
        containerStatuses: [
          {
            name: "app",
            image,
            imageID: null,
            ready,
          },
        ],
      });
    collection(namespace, "Pod", [
      pod(
        "api-old-1",
        old,
        service === "orders"
          ? "example.invalid/orders:older"
          : d.containers[0].image,
      ),
      ...(service === "orders" ? [pod("api-old-2", old, old.containers[0].image)] : []),
      pod("api-next-1", next, d.containers[0].image, service !== "orders"),
    ]);
  }
  // Complete empty inventory establishes absence; denied inventory never does.
  for (const kind of ["Deployment", "ReplicaSet", "Pod"])
    collection("stock-qa", kind, []);
  for (const kind of ["Deployment", "ReplicaSet", "Pod"])
    collection("sandbox-qa", kind, [], "failed");
  return seal({
    schemaVersion: CAPTURE_VERSION,
    adapter: "kubernetes-inventory/1",
    simulation: true,
    environment: "qa",
    cluster: "commerce",
    context: "synthetic-commerce",
    clusterIdentity: "operator-asserted",
    startedAt: CAPTURE_AT,
    finishedAt: CAPTURE_AT,
    collections,
  });
}
