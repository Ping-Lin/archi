// Synthetic wire-format specimens. No network traffic is captured by this module.
import { queryFor } from "../../src/traffic/model.mjs";
export function trafficFixture() {
  const end = Date.parse("2026-09-18T10:05:00Z") / 1000;
  const row = (from, to, count, status = "200", extra = {}) => ({
    metric: {
      reporter: "destination",
      source_cluster: "commerce",
      source_workload_namespace: from,
      source_workload: "api",
      destination_cluster: "commerce",
      destination_workload_namespace: to,
      destination_workload: "api",
      request_protocol: "http",
      response_code: status,
      ...extra,
    },
    value: [end, String(count)],
  });
  const attributes = (values) =>
    Object.entries(values).map(([key, value]) => ({
      key,
      value: { stringValue: value },
    }));
  const traceId = "11111111111111111111111111111111";
  const resource = (namespace, span) => ({
    resource: {
      attributes: attributes({
        "k8s.cluster.name": "commerce",
        "k8s.namespace.name": namespace,
        "k8s.deployment.name": "api",
        "service.name": "same-name-is-not-an-identity",
        "service.instance.id": namespace + "-process-1",
      }),
    },
    scopeSpans: [
      {
        scope: { name: "archi.synthetic" },
        spans: [
          {
            traceId,
            startTimeUnixNano: "1789725720000000000",
            endTimeUnixNano: "1789725720025000000",
            attributes: attributes({ "http.request.method": "GET" }),
            ...span,
          },
        ],
      },
    ],
  });
  return {
    schemaVersion: "archi/traffic-v1alpha1",
    simulation: true,
    environment: "qa",
    window: { start: "2026-09-18T10:00:00Z", end: "2026-09-18T10:05:00Z" },
    sources: [
      {
        id: "mesh",
        adapter: "istio-prometheus/1",
        coverage: "partial",
        sampling: "none",
        note: "Synthetic destination-reporter query. Coverage is not verified.",
        payload: {
          query: queryFor(300),
          response: {
            status: "success",
            data: {
              resultType: "vector",
              result: [
                row("experience-qa", "sales-qa", 285),
                row("experience-qa", "sales-qa", 15, "503"),
                row("sales-qa", "stock-qa", 120),
                row("sandbox-qa", "stock-qa", 0),
                row("experience-qa", "stock-qa", 30),
                row("unknown-namespace", "stock-qa", 7),
              ],
            },
          },
        },
      },
      {
        id: "traces",
        adapter: "otlp-json/1",
        coverage: "partial",
        sampling: "sampled",
        note: "Synthetic direct client/server pair, not full request coverage.",
        payload: {
          resourceSpans: [
            resource("experience-qa", { spanId: "2222222222222222", kind: 3 }),
            resource("sales-qa", {
              spanId: "3333333333333333",
              parentSpanId: "2222222222222222",
              kind: 2,
            }),
            resource("stock-qa", {
              spanId: "4444444444444444",
              parentSpanId: "5555555555555555",
              kind: 2,
            }),
          ],
        },
      },
    ],
  };
}
