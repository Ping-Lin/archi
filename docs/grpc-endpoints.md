# Bounded gRPC endpoint analysis

Opt in with source adapter `ai-evidence/3` and candidate bundle schema
`archi/ai-candidates-v1alpha3`. Existing /1 and /2 behavior is unchanged.
This is an evidence-bound AI/operator proposal workflow, not a Java/Kotlin gRPC
parser, an LLM integration, or runtime validation.

Each gRPC candidate uses `protocol: "gRPC"` and one of these endpoint bindings:

```json
{"kind":"host-port","hostKey":"gateway.peer.host","portKey":"gateway.peer.port"}
```

```json
{"kind":"grpc-dns","key":"grpc.orders.target"}
```

The second form requires an effective value such as
`dns:///api.sales-qa.svc.cluster.local:9090`. Keys are project-specific and must
be supported by pinned source citations. Keep conditions and unknowns explicit.
Use the normal `template`, `check`, `queue`, and scoped `review` CLI commands in
[AI candidates](ai-candidates.md); set /3 before generating the template.
Changing the schema, protocol, binding or evidence changes the candidate hash
and requires a new review. No review is automatically migrated.

The target instance must declare an endpoint like:

```json
{"name":"api","port":9090,"protocol":"gRPC","kind":"service"}
```

Rendered Helm must contain the matching Service TCP port and selector matching
the declared Deployment. Normal deployment binding rules still apply: cluster,
namespace, service identity and ambiguity cannot be bypassed by an AI review.
The Service TCP port alone does not establish gRPC protocol; this is explicitly
declared by the operator. Accepted, active candidates with complete effective
configuration can create an edge. Unreviewed/rejected proposals cannot.

## Meaning and boundaries

The normalized `grpc://host:port` value is **internal comparison identity only**,
not a gRPC client target URI. Edges retain `protocol: "gRPC"`,
`endpointAdapter: "grpc-endpoint/1"` and `transportSecurity: "unknown"`.
Property facts, placeholder inputs, source citations and review evidence remain
available in the UI and export. Host names are lowercased, one final DNS dot is
removed and numeric ports normalized (1–65535).

Supported: DNS-label hosts with explicit ports, split host/port or exact
`dns:///host:port`, combined with the separately selected bounded property adapter.
Unsupported: external gRPC targets, IPv6, implicit ports, custom resolver
authority (`dns://resolver/...`), bare targets in grpc-dns bindings, xDS, Unix
sockets, multiple addresses, authority overrides and dynamic target construction.
Unsupported inputs remain unknown, even with an accepted review.

No DNS lookup, connection, traffic collection or cluster call occurs. TLS/mTLS,
credentials, runtime resolver registration, service config, balancing and live
reachability are not inferred. Source evidence exposing any unresolved mechanism
must list it in candidate unknowns; byte-valid citations do not prove semantics.
See the official [gRPC name-resolution guide](https://grpc.io/docs/guides/custom-name-resolution/)
for why a target is not simply an HTTP URL.

## Synthetic walkthrough

```bash
node scripts/grpc-fixture.mjs artifacts/grpc-demo
npm run analyze -- --root artifacts/grpc-demo --system accepted.json --out ../analysis
npm run dev
```

Requires Node 22+, Git, dependencies and Helm v3.17.3; destination must be new.
Two authored Kotlin client specimens map portal to orders on port 9090. QA has
clearly synthetic reviews; production is unreviewed. No code is compiled or run
and no real human approval is represented. The fixture composes /3 placeholders
with the new endpoint adapter, while the orders → inventory HTTP path remains.

Next gaps: reviewed ConfigMap/Secret and Spring ConfigData imports, broader
resolver adapters, and separately authorized manual deployment validation.
