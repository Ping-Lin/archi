---
name: archi-system-design
description: Configure Archi simulations or onboard a synthetic repository to evidence-based analysis, with reviewed environment mappings and explainable service graphs.
---

# Archi system design

Choose the mode before editing. For v2 source/Helm analysis onboarding or service
graphs, read [references/analysis-onboarding.md](references/analysis-onboarding.md)
and `docs/model-v2.md`; use the analysis CLI, not the v1 generator. The remaining
workflow below applies to v1 authored simulation changes.

For Istio/OTel traffic evidence, read `docs/traffic.md`. Prepare the system analysis
first, then import a scoped capture with `npm run traffic`. Use exported wire-format
data with explicit coverage and sampling; generated specimens must remain labeled
synthetic. Confirm the actual metrics/trace backend before designing acquisition.
Validate identity resolution and evidence separately from static dependencies;
workload traffic cannot establish a particular source method or deployed commit.

Use the target Archi repository as the working root. Read `docs/model.md` and
`config/system.json` first. For a concrete scenario, read
[references/workflow.md](references/workflow.md). Execute the repository's existing
JavaScript CLI; do not create a second configuration generator.

## Working contract

- Establish the requested system boundary, project ownership, service identities,
  dependency direction and deployment contexts. Infer routine demo defaults and
  record assumptions; ask only when a missing answer changes system identity or scope.
- Keep logical service identity independent of cluster, namespace, release and
  version. The same service can have multiple deployment instances.
- `config/system.json` owns declared intent. `config/observations.json` owns
  timestamped observations. Never modify observations to make drift disappear.
- A Git revision needs explicit evidence. Preserve `sourceCommit: null` when
  unknown; do not convert image tags, branches or chart versions into commit SHAs.
- This generator accepts simulated systems only. For real repositories, capture
  their evidence and propose an adapter boundary; do not present fictional
  observations as live cluster data or enable production writes.
- Dependency protocol labels describe architecture. The PoC runtime simulates all
  calls over HTTP, including gRPC and AMQP. Do not claim transport equivalence.

## Complete a configuration change

Edit authored config and, only when necessary, the model validator or Helm template.
Keep examples, UI projections and values generated from the same contract. Use
stable IDs, validate references and ensure each deployed source has its dependency
target in the same context. Add focused tests for a new invariant or behavior.

Run from the repository root:

```bash
node .agents/skills/archi-system-design/scripts/setup.mjs --root .
npm run demo
```

The setup script validates, generates, checks determinism and runs tests. If Helm
is installed it also lints and renders every project/context. If unavailable it
reports an incomplete Helm gate; use `--require-helm` in CI. Never replace a missing
gate with a claim that it passed.

Report changed identities, generated outputs, assumptions, validation results and
remaining unknowns. Preserve the user's current publication decision: preparing
configuration does not itself authorize opening a PR or applying a chart. Save
skill modifications with the surrounding project using its authorized Git workflow.
