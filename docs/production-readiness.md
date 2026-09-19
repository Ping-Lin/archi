# Production-readiness hardening review — 2026-09-19

## Decision

**Not approved for production deployment yet.** The reviewed offline traffic slice
is hardened below. Archi still needs real-backend acceptance and an operating
security model. No PR, merge, cluster mutation or production telemetry acquisition
is part of this change.

## Fixes and their evidence

| Finding | Implemented correction | Regression evidence |
| --- | --- | --- |
| Split exports lost client/server relationships | Two-phase indexing per explicit correlation scope; retain both source locations | Split and reversed exports pair; different scopes do not pair; duplicates and conflicts tested |
| Claimed snapshot hash was trusted | Recompute canonical hash; validate snapshot ledger and existing report correspondence | Missing/stale/malformed hashes and dangling references rejected |
| Timestamp overflow could serialize as null | Strict decimal-string uint64 bounds, calendar validation and nonnegative duration | Overflow, coercion, invalid dates rejected; maximum uint64 remains finite |
| Malformed/oversized captures consumed unbounded input | Nested OTLP schema, JSON/file/source/record limits, finite metric totals | Malformed attributes/scopes, excessive depth/sources, oversized file and counter overflow rejected |
| Concurrent imports or failed writes could damage output | Exclusive output lock, input digest recheck, temporary write/fsync/rename and directory fsync | Foreign lock preserved; malformed input leaves original bytes; symlinks refused and own failed-import files cleaned |
| Java parser dependencies had known advisories | Pin transitive lodash and lodash-es to 4.18.1 using npm overrides | Lockfile updated; production dependency audit and parser regression suite required |

The dependency override is deliberate: upstream parsers pin vulnerable 4.17.21,
so a normal transitive update cannot replace it. Remove overrides only after
upstream adopts a reviewed safe version. CI now rejects moderate-or-higher production
dependency advisories. A clean audit is time-specific, not a security certification.

## Configuration reviewers must approve

Local verification: 26 base tests and 58 analysis/traffic tests passed (including
17 traffic tests), plus the skill extension scenario and all Helm lint/template
combinations. Cross-repository and traffic browser checks passed, including mobile,
environment separation and recomputed exported snapshot/report hashes. Production
dependency audit returned zero advisories after the override. The local runtime
was Node 24.19.0; CI independently exercises Node 22.

1. Keep `simulation: true` for the supplied fixtures. Do not relabel them as real.
2. For OTLP use `adapter: "otlp-json/2"` and an explicit `correlationScope` shared
   only by exports from one trusted trace domain. This is not an authorization check.
3. Require resource attributes `k8s.cluster.name`, `k8s.namespace.name`, and
   `k8s.deployment.name` to match the system instance bindings uniquely. No automatic
   `service.name` fallback or source-revision inference is introduced.
4. Keep one authoritative destination-reporter Istio metrics source per window,
   with the exact generated query and window-end evaluation timestamp.
5. Run imports in a trusted Linux job directory, serialize other writers, retain
   input bundles, and protect exported traces and identity metadata as sensitive data.

Runnable synthetic configuration and commands are in
[traffic.md](traffic.md); `examples/traffic/fixture.mjs` is the wire-format specimen.

## Remaining release gates, in order

| Priority | Gate | Acceptance evidence needed |
| --- | --- | --- |
| P0 | Real-data ingestion path | Explicit non-synthetic system analysis contract; one read-only adapter for the installed Prometheus and trace backend; no relabelled synthetic artifacts |
| P0 | Trust and access control | Backend-scoped credentials, least privilege, tenant boundary, authentication/authorization, TLS, artifact redaction and retention policy; never deploy the demo server as a public API |
| P0 | Real capture correctness | Known HTTP/gRPC requests; verify counts, retries/HA deduplication, trace sampling, split exports, missing propagation, label mappings and clock/window behavior against actual backend output |
| P0 | Operational durability | Chosen storage/queue model; crash/concurrency and recovery tests on target filesystem; supported Node/OS and deployment rollback runbook |
| P1 | Historical identity | UID/time-aware inventory, rollout mapping and deployment provenance; current name matching cannot prove source revision |
| P1 | Capacity and observability | Representative 32 MiB/50,000-record benchmarks, memory/time budgets, import outcome metrics, bounded logs and alerting; hard limits alone do not prove performance |
| P1 | Broader semantics | External/gateway edges, messaging/span links, compatible histogram latency, parser coverage gaps; unsupported cases must stay explicitly unknown |

Next milestone should be a private, read-only real-backend pilot with those P0
acceptance cases, not additional dashboard polish. Passing automated synthetic tests
does not close these gates. Existing historical reports remain historical results;
this document describes the new hardening boundary.
