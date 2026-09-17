# Phase two — analyzed service graph and onboarding portability

## Scope and outcome

Phase two adds the requested Service graph to the evidence-analysis workspace and
validates configuration-driven onboarding against a second synthetic layout. The
original authored commerce graph is unchanged. No PR or live deployment is included.

The graph is a projection of analyzed dependencies, not a second authored model.
Environment switching changes the actual edge set. Selecting an edge opens the
same resolution/facts used by the evidence inspector; disabled and unknown
candidates remain selectable without being drawn as active connections. Keyboard
activation, search, empty results and mobile scrolling are supported.

## Second layout

| Mapping | Checkout fixture | Logistics fixture |
| --- | --- | --- |
| Logical caller | checkout | dispatcher |
| Source root | application/ | modules/dispatch/src/main/java/io/demo/ |
| Approved client type | EndpointClient | RemoteClient |
| Chart root | chart/ | deploy/k8s/dispatch/ |
| Property source | application/application.yaml | config/base.yaml |
| Environments | dev, prod | qa, production |
| Internal target | gateway | routing-hub |
| Conditional behavior | dev-only sandbox | QA-only audit; production-only webhook |
| Unsupported pattern | Unregistered legacy factory | Dynamic constructor argument |

Only fixture/configuration inputs change: the analyzer and resolver are unchanged.
The independently authored oracle expects QA edges to routing-hub/audit and
production edges to routing-hub/webhook. Dynamic construction remains unknown.
Neither environment has runtime observations; these are source/config conclusions.

## Skill change

`archi-system-design` now separates v1 authored simulation from v2 analysis
onboarding. Its new workflow requires evidence for mappings, a reviewed property
source boundary, disclosure of unsupported constructs, independent expectations,
and deterministic reruns. It reuses the existing CLI rather than introducing
another dependency generator. The skill-creator guidance kept this as a focused
mode/reference addition; existing simulation behavior remains intact.

This is a controlled configuration-portability evaluation. Because the second
fixture and its config were constructed together, it does not prove that an AI
can autonomously onboard an unfamiliar real repository. A blinded evaluation and
approved internal pilot remain separate future gates.

## Acceptance gates

Local validation passed: **54 tests** (26 existing/frontend plus 28 analysis/graph),
with no skipped Helm cases; the skill validator, existing ninth-service scenario,
nine Helm combinations and browser checks for both layouts also passed. Browser
validation used Playwright 1.51.1 and explicitly selected Chromium 133; CI uses its
matching installed browser on Node.js 22.

- Existing v1/model/runtime tests and Vue templates remain green.
- Graph projection tests reject cross-environment, disabled and unexplained edges;
  search leaves source snapshots unchanged; parallel/self references remain distinct.
- Real Helm analysis matches both handwritten fixture oracles, and the second
  layout produces identical semantic hashes across AI-free reruns.
- Browser tests exercise both layouts, selecting actual SVG connections, viewing
  exclusions, switching environments, filtering and mobile containment.
- The existing skill scenario and nine Helm project/context combinations remain
  part of the verification suite. Missing Helm is an incomplete gate, not a pass.

## Remaining limits and next direction

The graph covers the selected analysis snapshot, currently one logical caller per
config; it is not yet a complete multi-caller system map. The second fixture proves
path/naming/profile portability within supported Spring patterns, not new framework
coverage. Gateway routing, multi-repository environment revisions, live deployment
collectors and release provenance remain outside this phase.

Next, add multi-caller input composition with explicit repository/workload identity,
then evaluate the skill against a separately prepared unfamiliar synthetic repo.
Use its unresolved cases to choose the next extractor extension. Do not infer
extra topology simply to make the graph denser.

## Run

```bash
npm ci --ignore-scripts
# Helm v3.17.3 on PATH
npm run check:analysis       # checkout graph
npm run dev                 # /?view=analysis
npm run analyze:logistics    # second layout; refresh the same UI
npm run verify
npm run check:helm
```
