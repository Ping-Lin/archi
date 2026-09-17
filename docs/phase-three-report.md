# Phase three — multi-caller system analysis

## Outcome

The evidence workspace can now compose several logical callers from one captured
repository and Helm render. The example resolves storefront → orders → inventory
→ external warehouse. QA additionally includes inventory → audit; production
disables that client. Unsupported dynamic construction remains unknown.

No authored dependency list was introduced. Every graph edge still comes from a
candidate resolution backed by Java/configuration/render evidence. No PR, merge or
live deployment is included in this phase.

## Decisions and findings

| Concern | Decision and observed result |
| --- | --- |
| Same bean name in multiple services | Candidate identity includes caller; the same Java file and downstream bean produce three independent candidates. |
| Effective properties | Every environment declares a separate scope for each caller; the same property key resolves to different endpoints. |
| Runtime attribution | Only orders has a QA observation; storefront/inventory and all production clients remain unavailable. |
| Environment comparison | Rows use source plus bean name, preventing same-name callers from collapsing together. |
| Render identity | All callers use one chart/cluster/namespace/release and captured input lock; mismatched composition is rejected. |
| Observation completeness | Retain per-caller metadata and comparisons; never claim complete system collection or manufacture an aggregate timestamp. |
| Graph layout | Top-down dependency ranks; cycle condensation terminates ranking; disconnected callers remain visible. Fan-out labels were adjusted after screenshot inspection. |

The original single-caller configuration and both previous fixtures remain
supported. The new form uses `sources` and per-environment `callers`, with exact
scope coverage required. Shared unqualified observation files are rejected.
The onboarding skill now documents when this form is appropriate and when the
repository/deployment boundary requires a future contract.

## Validation

- `npm run generate`: no generated changes.
- `npm run verify`: 58 tests passed (26 existing/frontend, 32 analysis), no skips;
  the existing ninth-service skill scenario also passed with Helm enabled.
- `npm run check:helm`: all nine existing project/context combinations passed.
- Real Helm v3.17.3 analysis matched handwritten oracles for checkout, logistics
  and the new system. Multi-caller semantic hashes repeat across assessment times.
- Existing browser, evidence browser, both phase-two graph fixtures and the new
  system browser passed using Playwright 1.51.1 with Chromium 133 locally.
- New browser checks cover observation isolation, five distinct comparison rows,
  QA/production edge changes, non-overlapping labels in the fixture, unknown
  candidates, filtering and mobile containment. CI runs the same cases with its
  standard matching Chromium installation.

## Limits and next direction

This remains a controlled synthetic evaluation of the supported Spring subset.
It does not prove autonomous onboarding of an unfamiliar repository. One shared
chart/repository/revision/namespace per environment is the implemented boundary;
independent repositories, releases and multiple instances of one logical caller
need explicit composition and identity contracts. No gateway backend routes or
unobserved traffic are inferred.

The next useful validation is a separately prepared onboarding fixture with a
different layout and withheld expected results. Measure mapping mistakes,
unresolved cases and required manual corrections before expanding framework
support. If the intended pilot uses independently released charts, design the
repository/revision/workload vector first; do not merge snapshots by service name.

The small-system graph is deterministic and cycle-safe, but not a dense-graph
layout optimizer. Add larger topology fixtures before selecting clustering,
collapse controls or a dedicated layout engine. Current evidence suggests that
identity and onboarding accuracy should take priority over extra visual features.

## Reproduce

```bash
npm ci --ignore-scripts
# Put Helm v3.17.3 on PATH.
npm run analyze:system
npm run dev
# Open http://127.0.0.1:4173/?view=analysis
npm run verify
npm run check:helm
```

Use `npm run analyze -- --config examples/system/archi.config.json --revision HEAD`
after the fixture is committed to freeze inputs at a Git revision. The working-tree
mode records captured byte hashes but is not an atomic capture across concurrent edits.
