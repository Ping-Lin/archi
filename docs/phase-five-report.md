# Phase five — offline traffic evidence

Date: 2026-09-18
Status: reviewable implementation; no PR, merge or live deployment.

## Delivered

- Versioned offline Istio/Prometheus and OTLP JSON imports with a strict envelope,
  bounded wire-format validation, explicit time window, coverage and sampling.
- Environment-scoped Deployment name mapping, preserving ambiguous/unmapped inputs.
- Independent workload-pair reconciliation, request increase, average RPS, status
  error rate and trace sample evidence. Static candidate conclusions are unchanged.
- Green observation support on the existing service graph; a Traffic evidence view
  for statistics, observed-only relationships, input records and unresolved identity.
- CLI atomic writeback, capture hashes, selected-environment export, synthetic
  fixture, CI browser coverage and updated system-design skill guidance.

Executable contract, reproduction commands and source references: [traffic.md](traffic.md).

## Demonstrated results

The existing cross-repository QA snapshot contains five static relationships.
The authored traffic capture supports two of them and adds one observed-only pair.

| Relationship | Metric increase | Average RPS | Error rate | Trace samples | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| portal → orders | 300 | 1 | 5% | 1 | supported |
| orders → inventory | 120 | 0.4 | 0% | 0 | supported |
| portal → inventory | 30 | 0.1 | 0% | 0 | observed-only |
| orders-shadow → inventory | 0 | 0 | unknown | 0 | not-observed |

The single paired server span lasts 25 ms. The capture also includes one unmapped
source and one unpaired server span. Production deliberately has no traffic capture.
All numbers are synthetic; no actual Istio installation or OTel exporter was tested.

## Verification

- Existing 26 model/runtime tests and 41 analysis tests passed, without skips.
- Eleven traffic tests passed, including CLI preservation/failure behavior, scoped
  and ambiguous mapping, duplicate handling, counter/status semantics, span parent
  matching, time-window boundary, sampling separation and deterministic hashes.
- `npm run generate`: zero generated changes. `npm run verify` passed (the final
  additional CLI case was then run with the traffic suite).
- Helm v3.17.3 lint/render passed for all project/context combinations; the skill's
  ninth-service scenario and skill metadata validator passed.
- Traffic browser passed graph overlay, count/error display, evidence, export,
  QA/production isolation and mobile containment. Cross-repository browser passed.
- Screenshots: `artifacts/phase-five-traffic.png` and
  `artifacts/phase-five-traffic-mobile.png`.

The first browser assertion needed to respect CSS text capitalization. A local
server-start race was resolved by waiting for HTTP readiness before browser checks.

## Design findings and next direction

1. **Reuse installed observability.** Istio and OTel are the selected sources;
   Hubble is unnecessary for this slice. Actual metrics/trace backends remain unknown.
2. **Identity is the main integration risk.** Matching cluster, namespace and
   Deployment names is useful but needs a real label sample. OTel process instance
   IDs must not be substituted for Archi deployment IDs. UID and time-aware inventory
   are required before claiming historical workload/release correspondence.
3. **Keep evidence granularity explicit.** Workload traffic can corroborate a pair,
   not a particular Java bean or repository revision. A green edge is not proof
   that the captured source commit produced that request.
4. **Respect measurement perspective.** Destination-proxy counts are not unique
   business operations. Backend HA deduplication, retries, gateway hops and missing
   reporter coverage need discovery. Sampled traces must stay separate from volume.
5. **The next useful validation is a real export.** Obtain an approved small
   Prometheus instant-query response and OTLP export, with known scope and window.
   Verify mapping against known requests before implementing backend acquisition.

Deferred: authenticated live queries, backend-specific Tempo/Jaeger conversion,
Collector configuration/deployment, verified production source capture, histogram
p95/p99, HTTP/TLS equivalence, async messaging, external-peer identity, gateway
route inference, full trace waterfalls, historical storage and dense traffic graphs.
Observed-only relationships currently appear in the table, not as invented static
graph edges. These limitations are also visible in the contract and capture UI.

Follow-up: the [2026-09-19 production-readiness hardening review](production-readiness.md)
records fixes for cross-export pairing, snapshot integrity, timestamp bounds,
safe offline imports and dependency advisories, plus remaining production gates.
