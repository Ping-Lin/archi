# Scenarios and acceptance evidence

## New fictional system

Translate the description into projects and services before assigning deployment
instances. Start with a small complete graph. Choose distinct local ports and
DNS-compatible IDs. Provide at least one context and all three views. For useful
review, include different desired versions across contexts, a dated observed-image
difference and a null commit. Clearly identify all links and observations as fixtures.

## Add a service

1. Add its owner project if missing, then a service with a stable ID and repoPath.
2. Add explicit dependency edges with protocol, purpose and evidence.
3. Add intended context deployments; check dependency closure in each context.
4. Add observations only when supplied by evidence or explicitly requested as mocks.
5. Generate and verify. A removed service should remove only generated files owned
   by the generation manifest. Keep user-authored files intact.

## Investigate drift

Compare declared image repository/tag, replicas and explicitly known commits with
the dated snapshot. Explain that readiness differences can be transient and that
an old observation is not current health. Unknown commits remain unknown even if
tags match. Record the source adapter and collection timestamp in future integrations.

## Import existing projects later

Read repository/Helm/CD metadata within access already granted. Helm identifies
workloads, images, namespaces and some links, but usually cannot prove business
boundaries, call direction or exact source revision. Present those as unresolved
or inferred, with evidence. An importer must emit candidate observations and a
reviewable diff; it must not overwrite the authored service catalog automatically.

## Example request

“Add a returns service owned by fulfillment. Orders calls returns over gRPC.
Deploy it to dev-local and both production contexts. Its image is 1.0.0 and the
source commit is unknown.”

Expected: an additional service descriptor, updated commerce dependencies and
fulfillment values in all contexts, updated explorer/Compose, no invented commit
or observed readiness, and passing consistency/runtime tests.
