# Traffic observations — first offline slice

Status: implemented offline import and synthetic validation. No production backend,
Collector receiver, cluster watcher or traffic generator is connected by this slice.

## Boundaries

`src/traffic/model.mjs` exports the strict `trafficBundleSchema`, `queryFor(seconds)`
and pure `analyzeTraffic(bundle, snapshot)`. Built-ins are `istio-prometheus/1` and
`otlp-json/2`. The existing system manifest and static snapshot remain unchanged.
The CLI adds `analysis.traffic[environment]`, replacing only that environment's
previous capture. It preserves other environments and writes the output atomically.
This is one window per environment, not a historical database.

The bundle owns `schemaVersion: archi/traffic-v1alpha1`, `simulation`, environment,
window `{start,end}` and sources. A source owns ID, adapter, declared coverage
(`available`, `partial`, `unavailable`), sampling (`none`, `sampled`, `unknown`), a
human-readable note and an inline payload. Unavailable sources require empty payloads.
Coverage describes supplied data; Archi does not certify instrumentation coverage.
The import CLI rejects mixed synthetic/real artifacts. Current system analysis is
synthetic-only, so this does not yet enable an end-to-end production workflow.

Each report locks the bundle, source payloads and static snapshot by hash. Evidence
identifiers include the input hash, source ID and record location. Metrics retain
label sets and vector indices; traces retain trace/client/server span IDs. Keep the
original bundle alongside its report to reproduce the locked input. Source hashes
prove which input was analyzed, not its authenticity or deployed source revision.

## Istio / Prometheus

Supply `payload: {query, response}`. `response` is a successful Prometheus HTTP API
instant-query JSON response with a vector result. `query` must exactly match
`queryFor(windowSeconds)`; evaluate it at the window end. Version 1 accepts positive
integer window seconds and one authoritative metrics source per bundle.

The query applies `increase(istio_requests_total{reporter="destination"}[Ns])`
before aggregating by reporter, source/destination cluster, workload namespace,
workload, request protocol, HTTP response code and gRPC response status. Counter
resets and extrapolation are handled by Prometheus, not by subtracting raw counters
in Archi. The adapter checks reporter, dimensions, values, unique series and query
timestamp; it does not execute PromQL or prove that a supplied response matches it.

Request increase can be fractional. Average RPS is increase divided by window
seconds. HTTP errors mean 5xx; gRPC errors mean a nonzero gRPC status. Missing or
invalid status with positive volume suppresses the combined error rate. A zero
denominator produces an unknown rate. Unknown protocols emit diagnostics.

Only destination reports are counted, avoiding source/destination double counting.
The backend must already deduplicate HA scrape replicas. Gateway hops and retries
remain proxy-level requests, not unique user transactions. A missing destination
reporter is not silently replaced with source telemetry. External egress may be
uncovered; capability discovery must report that limitation.

## OpenTelemetry

Supply `payload: {resourceSpans: [...]}` in OTLP JSON export-request form, including
resource attributes and scopeSpans. This is not Jaeger/Tempo query-response JSON;
backend-specific acquisition/conversion remains future work. OTLP numeric span
kinds, hex IDs and decimal-string uint64 nanosecond timestamps are required.
Nested resources, scopes, spans and attribute value types are validated before use.

Every OTLP source must explicitly declare `correlationScope`, including unavailable
sources. Use the same value only for exports belonging to the same trusted trace-ID
domain (for example, one backend tenant). All sources in that scope are indexed
before parent/child matching; clients and servers may arrive in separate exports.
Different scopes never join or deduplicate each other's spans. A scope is a caller
assertion, **not authentication or tenant isolation**. Do not combine untrusted
tenants into a single report; snapshot identity has no tenant dimension.

Migration: change the source adapter from `otlp-json/1` to `otlp-json/2` and add
`correlationScope: "commerce-qa"` (choose your actual trace domain). Version 1 is
rejected, rather than silently adopting cross-export joins. Metrics remain version 1
and must not declare a correlation scope. Reports record `traffic-reconciliation/2`.

Only direct CLIENT (3) to SERVER (2) pairs with equal trace ID and exact parent-span
correspondence produce observations. HTTP method attributes (current or legacy) or
gRPC system attributes identify the supported protocol. A shared trace ID alone
never establishes an edge. Unpaired server spans and unsupported protocols emit
diagnostics. Span links, asynchronous messaging, database operations, inferred
remote peers and full waterfall reconstruction are outside this version.

Include server spans whose start is within `[start,end)`; their parent may begin
earlier. Identical duplicate spans are deduplicated; conflicting copies fail import.
Repeated exports within a scope do not inflate trace sample counts. Pair evidence
retains both client and server source IDs and resource/scope/span indices, including
duplicate record locations. Server duration
is displayed as an individual sample, never p95 or complete population latency.
Sample counts are never added to metric counts or extrapolated into RPS.

## Identity and reconciliation

`cluster-namespace-deployment-name/1` maps both endpoints to explicit system instance
bindings. Istio supplies source/destination workload labels; OTLP supplies
`k8s.cluster.name`, `k8s.namespace.name`, `k8s.deployment.name`. All three fields must
match uniquely. Workload names must represent the bound Deployment, not a Pod name
or arbitrary canonical-service alias. No fallback to matching service.name is used.
OTel `service.instance.id` identifies an execution instance and is not Archi's
deployment instance ID. Missing identity stays unmapped; multiple matches remain
ambiguous, with alternatives retained. Such records do not create resolved edges.

This rule is name-scoped correspondence, not UID-based historical identity. It does
not prove which Pod incarnation, image digest or Git revision served the request.
Deployment recreation, rollout history and CD provenance require another evidence
source. The window and `releaseCorrespondence: unverified` remain visible.

Reconciliation groups by `(source instance, target instance, protocol)`. Supporting
a workload relationship does not establish which Java bean/method made the call.
Multiple static dependencies can share one observed relationship. Protocols are
matched exactly: HTTP telemetry does not automatically establish HTTPS/TLS use.

| Result | Meaning |
| --- | --- |
| supported | Static relationship and positive traffic evidence coexist |
| observed-only | Positive traffic exists without a matching static relationship |
| not-observed | No positive matching evidence in the supplied, usable capture |
| insufficient-evidence | All sources unavailable or none supplied |

No result claims that an unobserved dependency is absent. `not-observed` is scoped
to the capture, not a claim of complete coverage. Unsupported/unmapped inputs and
backend notices remain visible. Static candidate runtime fields are not rewritten:
those fields belong to the earlier candidate-specific evidence contract.

## Reproduce the synthetic scenario

Requires the normal analysis dependencies and Helm v3.17.3. Use new fixture paths;
both fixture commands refuse existing destinations.

```bash
npm run fixture:cross-repo -- artifacts/traffic-system
npm run analyze -- --root artifacts/traffic-system --system system.json \
  --oracle ../../tests/fixtures/cross-repo-oracle.json --out ../analysis
node scripts/traffic-fixture.mjs artifacts/traffic/bundle.json
npm run traffic -- --analysis artifacts/analysis/analysis.json \
  --bundle artifacts/traffic/bundle.json --out artifacts/analysis/analysis.json
npm run dev
# Open /?view=analysis; choose Traffic evidence.
```

The fixture contains 300 portal→orders requests (15 HTTP 503), 120 orders→inventory
requests, 30 portal→inventory requests absent from static analysis, zero shadow
requests, an unmapped source, one paired trace with a 25 ms server span, and an
unpaired server span. These are authored wire-format specimens, not captured traffic.

The graph highlights static workload relationships with positive observation
support. The Traffic evidence table includes observed-only relationships, scoped
counts, evidence inspection and unresolved identities. Production has no capture
until imported separately. The UI displays the absolute capture window and never
labels it live. Export with traffic uses an `archi/inspection-v1alpha1` envelope
containing the unchanged `snapshot` and its `traffic` report, preserving each hash's
boundary. Export without traffic retains the existing snapshot-only format.

## Import safety and operating contract

The importer verifies canonical SHA-256 `contentHash` values on every static
snapshot and every existing traffic report, checks environment correspondence and
validates the static evidence ledger before adding a capture. Missing/stale hashes
fail closed; regenerate analysis instead of manually changing its hash. Hashes
detect content mismatch, not a malicious producer that can recompute them.

Window timestamps must be valid UTC ISO strings, with optional 1–3 fractional
digits, for example `2026-09-18T10:00:00.000Z`. Nanosecond timestamps must be
canonical decimal strings in `[0, 18446744073709551615]`; numeric JSON values,
overflow and negative durations are rejected. Metrics accept finite nonnegative
decimal/scientific strings; timestamps must be numeric and match the window end.
Accumulated request totals may not overflow.

Limits per import: 32 MiB per input/output file, 32 sources, 50,000 total metric
rows/spans, JSON depth 64 and 500,000 JSON values per validated document. These are
safety ceilings, not a throughput guarantee. The pure in-memory API enforces the
structural/record limits; the CLI additionally enforces byte limits.

Use Node 22+ on Linux/POSIX with a trusted, locally owned directory and filesystem
supporting exclusive creation, atomic rename and directory fsync. Final input/output
symlinks, hardlinked files and nonregular files are rejected. An existing output
must be the analysis input itself; other output paths must be new. Successful
outputs use owner-only permissions (0600); explicitly grant a separate UI reader
access where needed. Do not expose raw artifacts via a public static server.

The importer creates `<output>.lock` exclusively before reading, writes and fsyncs
a unique temporary file, then renames and fsyncs the directory. It checks that the
analysis input has not changed before committing. Validation failures preserve the
original output. A post-rename durability failure explicitly reports that the new
output is already installed. Crashes can leave a lock or temporary file: confirm
the recorded owner process has stopped before manual recovery; never auto-delete
locks solely based on age. The lock serializes cooperating traffic importers only.
Do not run analysis generation or unrelated writers against the same output during
import. This is not a transaction protocol for hostile directories, NFS or multiple
hosts; use a job queue/object-store generation preconditions for such deployments.

See [production-readiness acceptance](production-readiness.md) for completed fixes
and remaining release gates. Offline validation is not production deployment approval.

## Next integration decisions

Before a real capture, identify the Prometheus-compatible endpoint, metric labels,
backend HA deduplication, mesh reporter coverage and the actual trace store. Discover
whether OTel exports traces and which services propagate context. OTel installation
alone does not establish trace availability. Resolve any differences between mesh
cluster/workload labels, OTel resource attributes and system bindings explicitly.

Then implement one read-only acquisition adapter for the installed backend, retain
query/export metadata, and validate with known test requests. Follow with histogram
latency aggregation (compatible buckets only), UID/time-aware inventory bindings,
and external/gateway coverage. Hubble is not a dependency of this direction.

## Primary references

- [Istio standard metrics and reporter labels](https://istio.io/latest/docs/reference/config/metrics/)
- [Prometheus query API](https://prometheus.io/docs/prometheus/latest/querying/api/)
- [Prometheus increase semantics](https://prometheus.io/docs/prometheus/latest/querying/functions/#increase)
- [OTLP JSON encoding](https://opentelemetry.io/docs/specs/otlp/)
- [OTel service identity](https://opentelemetry.io/docs/specs/semconv/resource/service/)
