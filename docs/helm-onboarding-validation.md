# Helm portability and onboarding validation

This milestone tests configuration portability without changing parser semantics.
All fixtures remain synthetic; nothing is installed in a cluster. Runtime
acquisition stays explicitly on demand. Polling, scheduled collectors, WATCH,
SSE and WebSocket are not planned.

## Compatibility matrix

| Input difference | Maintained regression |
| --- | --- |
| Flat values and one reusable chart | Existing cross-repo fixture |
| Nested workload/settings/client values | New portability chart |
| Common values followed by environment/release overrides | New fixture; reversed order deliberately loses a target |
| Helper-generated workload and Service names | Exact bindings; incorrect endpoint binding cannot invent an edge |
| Omitted resource namespace | Explicit Helm release namespace supplies scope |
| Shared chart plus separate chart directory | Portal/orders/shadow share one chart; inventory uses another |
| Independent releases, same logical service in multiple namespaces | Existing source specimens retain orders and orders-shadow identities |

The chart variant intentionally preserves the source behavior and uses the existing
handwritten cross-repo oracle: five QA and four production dependencies, disabled
production audit, unresolved missing endpoint and unknown dynamic factory. Expected
outcomes are not regenerated from analyzer output. Repeated analyses at different
assessment times must have equal semantic hashes. Reversing only QA portal values
must not alter production's snapshot hash.

## Reproduce

```bash
# Run from the Archi repository; Node 22+, Git, dependencies and Helm v3.17.3 required.
node scripts/helm-portability-fixture.mjs artifacts/helm-portability
npm run analyze -- --root artifacts/helm-portability --system system.json \
  --oracle ../../tests/fixtures/cross-repo-oracle.json --out ../analysis
node --test tests/analysis/helm-portability.test.mjs
```

The fixture command refuses an existing destination. The analysis command writes
the normal UI output; choose a different `--out` to preserve the displayed baseline.
Local Helm-dependent tests skip explicitly when Helm is missing; CI requires Helm.

## Onboarding handoff

The repo-local `archi-system-design` workflow now inventories approved CD inputs,
classifies compatibility, proposes evidence-backed bindings, checks independently
reasoned outcomes, and reports remaining gaps. It distinguishes real-input system
analysis from synthetic-only legacy configs and never automatically queries a cluster.

This is a controlled portability regression, not a blinded test of autonomous
onboarding. Kotlin/gRPC parsing, envFrom/mounted properties, unsupported resources,
inline CLI overrides, remote chart dependencies and CD post-renderers still require
explicit compatibility work. New config paths cannot supply missing semantics.
Actual CD equivalence, RBAC and end-to-end deployment correctness remain manual gates.

## Validation record

The four portability tests passed with Helm v3.17.3, including deterministic reruns
and both negative mapping/precedence cases. Full verification and project/context
Helm lint/render passed locally; regeneration changed no generated files.

A separate agent read the revised workflow and approved raw source/chart/overlay
files, without reading the generated manifest, fixture generator, tests or oracle.
It identified the nested values and helper-derived names, but withheld final
bindings pending confirmed CD release names, namespaces, cluster/capabilities,
repository SHAs, ownership, shadow identity and external-target/completeness review.
This is a proposal-only forward check of uncertainty handling. It does not measure
fully autonomous configuration accuracy or prove a completed real-world onboarding.
