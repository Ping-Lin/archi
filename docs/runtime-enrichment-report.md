# Runtime enrichment implementation review — 2026-09-24

Status: first Deployment slice implemented for review on `feat/architecture-poc`.
No PR, merge, live-cluster request or deployment was performed.

## Delivered

- Separate hashed capture, cluster reconciliation report and environment overlay;
  static snapshots, source candidates, dependency edges and traffic reports remain intact.
- Three-state image inspection: selected source baseline, workload spec, individual
  owned Pods. Mixed image versions and workload differences remain visible together.
- Independent presence, image-reference alignment, rollout, availability, acquisition,
  freshness and Pod coverage. UID/controller ownership prevents name-based reassignment.
- Bounded read-only kubectl collector with explicit context, kubeconfig and namespace
  scope; complete/partial/failed pagination; allowlisted output and sanitized failures.
- Safe exclusive capture creation and a shared locked atomic importer for runtime
  and traffic. Importing another cluster preserves existing cluster reports.
- Explicit real-input system manifest mode, included in input hashes; synthetic
  fixtures stay synthetic and imports reject synthetic/real mixing.
- Graph badges, keyboard navigation, workload inspector, capture timestamps, reason
  descriptions, advancing freshness and verifiable export.

## Verification

The full local verify gate passed 26 base tests and 72 analysis/traffic/runtime
tests, plus the skill extension scenario. A subsequent subprocess-argument regression
also passed (99 unique tests in total, including 14 runtime tests). Focused runtime
tests were rerun after the ownership lookup optimization. Helm lint/template passed
for all existing project/context combinations; generation changed zero files.
Production dependency audit reported zero known vulnerabilities at verification time.

Runtime, traffic and cross-repository browser checks passed. Runtime checks cover
graph navigation, three image states, complete versus failed collection, independent
traffic highlights, QA/production isolation, mobile containment, and recomputation of
every exported artifact hash. Generated screenshots are included in CI artifacts:
`runtime-graph.png`, `runtime-details.png`, and `runtime-mobile.png`.

The collector was exercised with injected API pages and a local executable test
double, including pagination failures and literal command arguments. These are
transport/contract tests, not evidence of successful authentication or collection
against an actual Kubernetes server. Local Node version was 24.19.0; repository CI
independently runs Node 22.

## Self-review and remaining limits

The original two-state drift proposal would conflate source/config differences
with ongoing rollouts. The implementation preserves these distinctions and calls
the repository render a baseline, not proven deployment intent. Digest strings and
reported image IDs remain evidence, not automatic binary or source equivalence.

Collection is namespace-scoped and not atomic across resource kinds. A partial list
can establish observed presence but never absence. Cluster identity is asserted by
the operator. No authn/authz server, hosted tenant boundary or credential service was
added. Use trusted local directories and kubeconfig; do not expose the demo server
or raw source/configuration artifacts publicly.

Controller counts can disagree temporarily with Pod observations, so availability
is labeled at capture and never presented as end-to-end application health. Resource
limits are safeguards, not a demonstrated production capacity budget. Live-cluster
acceptance, target-filesystem crash recovery and representative load remain required.

Next: run one explicitly approved, read-only capture against the intended cluster
and compare known rollout scenarios. StatefulSet/DaemonSet semantics, init containers,
endpoint availability, developer links and polling remain separate later slices.

See [configuration, QA matrix and operating contract](runtime-enrichment.md).
