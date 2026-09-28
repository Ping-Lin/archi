# Review-first onboarding workflow

Use this for approved real repositories or cross-repository synthetic evaluations.
Do not infer topology from naming alone or rewrite the chart to match the demo.

## 1. Inventory approved inputs without execution

Record repository roots and exact commits; distinguish source from deployment
configuration repositories. Inspect only authorized files. Locate chart roots,
helpers, dependency inputs, ordered values and source/config entrypoints. Do not
execute CD scripts, download dependencies, expose secrets or query a cluster.
Do not assume a filename or branch proves an environment.

Record the actual CD render context: release name, namespace, cluster identity,
Helm/Kubernetes versions, API capabilities, values order and external transforms.
If the actual CD command is unavailable, mark equivalence unverified, not complete.

Classify every difference:

| Class | Examples | Action |
| --- | --- | --- |
| Supported mapping | Different chart paths, nested values, helper names, independent releases | Bind exact rendered resources; preserve values order |
| Missing inputs | Unknown overrides, unavailable profiles, external property sources | Ask for approved inputs; retain unknown; do not set propertiesComplete true |
| Unsupported semantics | Kotlin/gRPC factories, envFrom/mounted configuration, arbitrary --set interface, post-renderers, mesh routes | Report adapter/render gap; do not disguise it as config |
| Requires runtime authorization | Credentials, RBAC, cluster inventory, traffic backends | Keep separate and opt-in; do not acquire automatically |

## 2. Propose a manifest with reasons

Use `archi/system-v1alpha1` and the current schema, not a new config generator.
For each logical service, instance and release, record proposed ID, ownership,
repository/commit/file evidence, environment scope and confidence/unknowns.
Keep shared chart versus shared release distinct. Multiple instances may share
source while binding different workloads and scopes. Resolve helper-generated
names through the authorized local render, never a guessed naming convention.

Use exact Deployment and Service endpoint bindings. Set propertiesComplete only
when the supported input boundary was explicitly reviewed. Keep unsupported or
missing data visible. Use separate manifests for different environment revisions.
Keep real and synthetic inputs separate; never manufacture deployment observations.

Prepare an independently reasoned expected outcome list before inspecting analyzer
results: intended source/target pairs, disabled cases, unresolved/unsupported cases
and the evidence supporting each expectation. Never copy analyzer output as oracle.

## 3. Validate locally and review differences

After approval to create/run the proposed configuration, use the existing CLI:

```bash
npm run analyze -- --root APPROVED_ROOT --system system.json --out NEW_OUTPUT_A
npm run analyze -- --root APPROVED_ROOT --system system.json --out NEW_OUTPUT_B
```

Choose new output directories to preserve prior evidence. Compare semantic
snapshot hashes, not assessment timestamps. A supplied independent oracle can be
checked with `--oracle PATH`; without one, report verification as not provided.
Inspect diagnostics, coverage, source evidence and per-instance endpoint mappings.
Do not modify expected results just to obtain green output. Classify discrepancies
as a mapping error, missing input, unsupported semantics or an implementation defect.

Do not claim matching local render proves CD equivalence or deployment correctness.
If Helm is unavailable, report the gate as incomplete; never simulate a passing render.

## 4. Handoff

Return a concise report with:

- Approved scope and input mode; repository revision vector.
- CD input inventory, unknown overrides and compatibility classification.
- Mapping table with evidence and explicitly reviewed assumptions.
- Expected versus actual outcomes, diagnostics and unresolved cases.
- Reproduction commands, output paths and deterministic hash comparison.
- Manual corrections required; remaining adapter work and real-environment gates.

Offer Runtime setup only after static analysis is understood. Configure approved
targets using the adoption guide; do not query them until asked. Runtime is
one-shot/on-demand only, with no polling or background subscription. A version
difference, rollback or mixed rollout is not an error without failure evidence.
Preserve the user's branch/PR decision. No deployment is part of onboarding.
