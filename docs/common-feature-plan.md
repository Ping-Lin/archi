# Common-feature implementation plan

Baseline: `1631fe0`; reviewed 2026-10-18. Work stays on
`feat/architecture-poc`; no PR, merge, cluster deployment or polling.

## Ordered backlog

| Order | Priority | Deliverable | Acceptance gate |
| --- | --- | --- | --- |
| 1 | P1 | Common client extraction: bounded Java HTTP factories, then Feign, Kotlin/gRPC | Versioned adapters; positive and adversarial fixtures; source/property evidence; unsupported code remains unknown |
| 2 | P1 | Configuration binding: bounded ConfigurationProperties and relaxed names | Independent binding expectations; ambiguity and precedence tests; no guessed aliases |
| 3 | P1 | Common ConfigData imports and startup overrides | Shared import deduplication, file/classpath mappings, then args/system properties; compare each slice against real Boot |
| 4 | P1 | Per-environment repository revisions | Independent QA/prod locks; pinned provenance; environment-isolation regression |
| 5 | P1 | Gateway routing and additional workload kinds | Separate route/controller adapters; scoped identities; ambiguous routes stay unresolved |
| 6 | P2 | Profile groups/includes and bootstrap directives | Ordered activation and negative cases verified against Boot |
| 7 | P2 | JDBC/Redis/Kafka/RabbitMQ relationships | Explicit protocol/resource semantics, not HTTP edge reuse |
| 8 | P2 | Secret-backed configuration | Approved acquisition/redaction contract before any secret access; opaque values remain unknown |
| 9 | P3 | Metrics/trace backend acquisition | Explicit backend and authorization; one-shot capture; known-request acceptance |

Real-project acceptance runs alongside these milestones when an approved specimen
is available. Synthetic tests never close that gate. Each row contains multiple
reviewable slices, not a promise of complete framework support in one change.

## First slice: Java HTTP factories

Status: implemented in `41e11cc`; all three CI jobs passed (run `39114098263`).

Add opt-in `spring-http-factory/1` for explicitly imported Spring RestClient and
WebClient, with a single literal `@Value("${key}") String` parameter:

- `return RestClient.create(url);` (or WebClient).
- `return RestClient.builder().baseUrl(url).build();` (or WebClient).

Retain the existing bounded Configuration/Bean/condition rules. Reject injected
builders, customizers, request factories, dynamic URLs, additional statements,
shadowed types and unsupported annotations. Previous source adapters stay unchanged.
The extracted endpoint is a configured **base URL**, not proof of request routing:
absolute request URIs, later mutation, redirects and proxies are not analyzed.

Follow-up slices: Feign registration, ConfigurationProperties consumption, Kotlin
and gRPC factories. General Java dataflow and automatic whole-program completeness
are not part of this first slice.

Regression correction: the previous constructor adapter checked obsolete CST node
names for inheritance. Both adapters now enforce the already-documented no-inheritance
boundary using `classExtends`/`classImplements`. Previously accepted inherited
configuration classes now correctly remain unknown.

## Second slice: explicit Feign clients

Status: implemented in `f5f2d10`; all three CI jobs passed (run `39114610980`).

`spring-feign/1` joins explicit EnableFeignClients class literals to fully qualified
Feign interfaces and resolves exact annotation URL property references. Both source
inputs and the reviewed activation/defaults policy enter evidence. Name-only discovery,
scanning, custom configuration, duplicate registrations and framework overrides stay
unknown. See [supported scope and tests](feign-clients.md).

## Third slice: ConfigurationProperties record consumption

Status: implemented in `71991a3`; all three CI jobs passed (run `39429535162`).

`spring-record-client/1` joins explicit record registration, canonical String member
keys and direct HTTP factory accessors. Custom bodies, mutable/nested types, missing
registration and relaxed aliases remain unsupported. See [record binding](record-client-binding.md).

## Fourth slice: mutable ConfigurationProperties beans

`spring-bean-client/1` supports explicitly registered, public mutable beans with
plain private String fields and trivial getter/setter pairs. Direct getters feed
HTTP factory base URLs; custom logic and noncanonical keys remain unresolved.
See [bean binding](bean-client-binding.md). Parser/resolver tests, pinned Helm
composition and six independent Boot expectations form the acceptance gate.

Next: assess bounded relaxed-name precedence with independent Boot expectations. Kotlin/gRPC extraction remains in
the P1 backlog; no general Java/Kotlin dataflow completeness is claimed.
