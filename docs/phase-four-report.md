# Phase four — implemented contracts and cross-repository composition

## Outcome

The analyzer now composes independently pinned source and deployment repositories.
Project, repository, logical service, deployment instance and Helm release have
separate identities. The new manifest and closed adapter interfaces reuse the
existing Java/Helm analysis and evidence explorer. See [the implemented contract](model-composition.md).

The synthetic fixture contains four Git repositories (portal, orders, inventory,
deploy), three ownership projects, four separate releases per environment and four
deployment instances. Every release intentionally renders a Deployment and Service
named `api` in a different namespace. `orders` and `orders-shadow` are separate
instances of the same logical service and source revision.

| Environment | Included relationships | Preserved exclusions |
| --- | --- | --- |
| QA | portal → orders; orders → inventory; orders-shadow → inventory; inventory → warehouse; portal → audit | Missing endpoint unresolved; dynamic construction unknown |
| Production | Same chain and shadow relationship, without audit | Audit disabled; missing endpoint unresolved; dynamic construction unknown |

No diagram edges are supplied by the fixture builder. The handwritten oracle is
separate from the source/chart specimens and checks analyzer dispositions. This
remains a controlled synthetic regression, not an independent blinded onboarding study.

## Decisions and review findings

- Exact source/config commit SHAs form a revision vector. Dirty repository files do
  not affect analysis; advancing only the orders revision changes its vector entry
  and supported candidate outcomes without rewriting other repositories' identities.
- Endpoint resolution checks caller cluster, target namespace/DNS/port, explicit
  binding, rendered Service and Deployment, and matching pod selectors. Same-name
  resources do not collapse across namespaces. Shared resource claims fail explicitly.
- Ambiguous aliases remain alternatives with no edge. Missing bindings, unsupported
  construction and incomplete property policy retain their uncertainty and evidence.
- Adapter result schemas and manifest schemas are executable; arbitrary adapter IDs,
  unpinned revisions, unknown fields and unsafe repository file paths are rejected.
- The graph initially routed a long connection through an intermediate node. Browser
  verification exposed this; long edges now use an outer route and fixture label/node
  overlap is checked. Labels and keyboard activation select the exact candidate.

## Verification

Local verification passed **67 tests** (26 existing/frontend and 41 analysis), with
zero failures or skipped cases. All nine legacy Helm combinations, the ninth-service
skill scenario and skill validation passed. Browser suites for checkout, logistics,
the shared-chart system and the cross-repository system passed with Playwright 1.51.1
and locally selected Chromium 133. CI uses its matching Playwright browser.

The acceptance suite includes existing v1/v2 regressions and focused cross-repository
cases: deterministic reruns, schema/path validation, instance and environment isolation,
selective revision updates, selector/transport checks, missing/ambiguous bindings and
conflicting release ownership. Helm and browser checks use real local rendering/browser execution;
Java specimens are parsed, not compiled or run as Spring services.

Browser coverage includes all previous fixtures plus project/instance evidence,
four visible pinned revisions, seven distinct environment-comparison rows, excluded
endpoints, production edge changes and mobile containment. Screenshots show the actual
running application rather than a mockup.

## Remaining boundaries and next work

The first system manifest has one revision vector per run. Different environment
versions of the same repository require separate manifests. Remote cloning/fetching,
automatic CD/release discovery and verified source-to-deployment bindings remain out
of scope. System-mode runtime observations are deliberately unavailable pending an
instance-scoped collector contract; legacy single-repo observations remain supported.

The current adapters still cover the bounded Java Spring subset and selected Helm
resources. Kotlin, gRPC stubs, mesh routes and broader configuration loading need
explicit adapter work. Config cannot add those semantics by changing paths alone.

Next, evaluate onboarding mappings against a separately prepared unfamiliar fixture
using the now-explicit contracts. Measure mapping corrections and unsupported cases.
If real environment revision comparison is the priority, extend the manifest to
per-environment revision vectors before adding collection automation. Keep these
decisions separate from graph layout enhancements.

This phase is saved on the review branch. No PR, merge or live deployment is included.
