# Runtime consistency and independent CD review

Date: 2026-09-25. Rule: `deployment-runtime/2`.

## Decision

Version differences describe state, not errors. The analysis layer compares the
selected render, workload spec and owned Pods. The UI displays that report alongside
capture time, freshness, collection coverage and original controller failure reasons.
Count discrepancies request verification; explicit controller failures are separate.
Helm/schema/render validation failures remain at their existing validation gates.
Archi cannot infer a Helm mistake from an image difference or failed rollout.

## Automated scenario coverage

`examples/runtime/timeline.mjs` contains authored normalized synthetic inventories
and baselines. These are not actual CD runs, Helm installations or captured releases.
`tests/fixtures/runtime-timeline-oracle.json` is a separately authored expectation
table; neither the fixture nor the reconciler generates it. Run
`node --test tests/analysis/runtime*.test.mjs` (also included in `npm run verify`).

| Phase | QA baseline / observation | Expected result |
| --- | --- | --- |
| T0 | Baseline v1; both services v1 | Matching, information |
| T1 | Baseline v2; both services still v1 | Different, information |
| T2 | Portal CD finishes v2; orders stays v1 | Orders different, information |
| T3 | Orders spec v2; two old Pods and one new Pod | Progressing, mixed references, information |
| T4 | Same mixed rollout; controller reports deadline exceeded | Reported failure, original reason retained; old replicas still available |
| T5 | Orders rolls back to v1; selected baseline remains v2 | Different, complete, information |
| T6 | QA finishes v2; production remains v1 | Both independently matching their environment baseline |

Production stays v1 throughout all seven phases. Every phase checks both environments,
input immutability, ownership count consistency and unverified release correspondence.
Additional tests remove a Pod, truncate a list, delay observedGeneration and supply
failure/non-failure conditions. Existing importer tests cover separate environment and
cluster overlays, static/traffic preservation, hashes and atomic writes. Browser tests
check neutral version differences and visible controller-reported failures.

## Self-review and corrections

1. The earlier fixture declared three Deployment replicas but supplied two Pods;
   ReplicaSet counts and the old template also disagreed. Corrected owner templates,
   three-Pod surge counts, ready counts and resource-specific nullable fields.
   Removed fabricated identical image IDs across different images; identity is unknown.
2. `Progressing=False` alone was described as failure. Restricted failure classification
   to explicit supported conditions and made the generic reason wording neutral.
3. Old controller generations must not certify the new spec or establish a current
   failure. Failure classification and consistency checks require observed generation.
4. Non-atomic collection can explain count discrepancies. They request verification,
   never become deployment errors or cause otherwise well-formed captures to be rejected.
5. Failure must be discoverable without opening details: the table now includes an
   assessment column; details preserve exact reason and evidence. Historical freshness
   remains a separate dimension. No automatic root-cause or remediation is claimed.
6. Reused the existing ownership index for ReplicaSet checks to avoid repeatedly
   scanning all Pods for each ReplicaSet.

## Verification results

Local `npm run generate` produced no changes. `npm run verify` passed 26 core tests,
82 analysis tests and the skill extension scenario. Helm lint/template checks passed
for every generated project/context combination. The runtime browser check passed
desktop/mobile layout, neutral differences, controller failure detail/table display,
export hashes and environment isolation. Reviewed the rendered runtime detail screenshot.
These are local synthetic checks; real-cluster acceptance below remains unexecuted.

## Manual deployment acceptance (not executed)

Use an approved disposable namespace and explicit kube context. The operator owns
deployments and cleanup; Archi's collector remains read-only.

1. Record actual chart/config/source revisions independently, render values and validate
   Helm/schema inputs. Keep validation output. Confirm an intentionally malformed chart
   fails this gate without treating it as a runtime version difference.
2. Deploy v1, capture explicit scope and import it against the selected baseline.
   Compare Deployment → ReplicaSet → Pod UIDs, images and counts against kubectl output.
3. Advance only the repository baseline, then only one service's CD. Confirm informational
   differences; do not interpret source pins as proof of the deployed release.
4. Capture during a rolling update. Preserve partial and mixed-version observations;
   repeat capture to investigate count discrepancies rather than calling them failures.
5. In the disposable namespace, exercise an operator-approved failed rollout. Preserve
   the controller condition, reason and generation. Verify the UI distinguishes failure
   evidence from available old replicas and from stale captures.
6. Roll back; confirm that a baseline/image mismatch remains informational. Recapture
   after controller convergence, then verify environment isolation with production's
   separately approved inventory. Record expected/actual results and operator sign-off.

## Remaining limits and direction

Automated tests validate deterministic interpretation of synthetic input. They do not
validate real CD execution, real collector permissions or end-to-end service health.
Pod readiness, orphan ownership and container-template differences are not certified by
the count checks. Only Deployments and the supported condition allowlist classify
controller failure; StatefulSets, Jobs, events and application failures need separate rules.
No broad production-readiness claim follows from a green test suite.

Next priority is manual acceptance with a small approved Istio/OTel and inventory export,
followed by explicit deployment provenance if release correspondence is required. Add
new runtime checks only with evidence boundaries and independent expected outcomes.
