# Evidence analysis milestone — implementation report

Date: 2026-09-17. Branch: `feat/architecture-poc`. This implements the bounded first slice from the [design review](design-review-2026-09-17.md). No PR, merge or cluster deployment is included.

## Delivered behavior

Archi now reads synthetic Java source and actual Helm-rendered YAML into an environment-scoped evidence model. It no longer needs a manually authored dependency list for this example. The existing v1 commerce demonstration remains available.

| Candidate | Dev | Prod | Explanation |
| --- | --- | --- | --- |
| clientA | Included → gateway | Included → gateway | Explicit bean, effective environment-specific endpoint, matching rendered Service/DNS/port |
| clientB | Included → external sandbox | Disabled | Supported dev-only profile |
| clientC | Disabled | Disabled | Explicit property condition is false |
| legacyClient | Unknown | Unknown | A source factory without supported bean registration is not proven active or disabled |

The result is **two dev dependencies and one prod dependency**. Production analysis succeeds without deployment or runtime input. Each candidate retains a resolution and its input facts, including excluded and unresolved candidates.

The Evidence lab UI provides:

- Connection selection and a source → property precedence → rendered target → optional runtime evidence trail.
- Independent eligibility, target mapping, runtime support, consistency and freshness display.
- Environment comparison, including the dev-only client and missing production runtime evidence.
- Resource presence separate from health: the fixture's matching checkout image can be progressing, while an unmanaged worker exists only in supplied observations.
- Scoped diagnostics, input-fact inspection, JSON export and mobile layout.

## Verification

| Gate | Result |
| --- | --- |
| Existing unit/runtime/frontend suite | 25 passed |
| New analysis acceptance suite | 23 passed; real Helm enabled; no skips |
| Generated v1 output consistency | No changes |
| Existing ninth-service skill scenario | Passed, with Helm validation |
| Existing Helm project/context gate | All nine combinations linted/rendered successfully |
| Independent analysis oracle | Dev/prod A/B/C/legacy dispositions match |
| Existing browser interactions | Passed |
| Analysis browser interactions | Evidence, exclusions, prod isolation, comparison, resources, export and mobile passed |

Local browser validation used Playwright 1.51.1 with an explicitly selected Chromium 133 executable because the standard browser download failed. CI is configured to install Playwright's matching Chromium and run both browser suites on Node.js 22. Local JavaScript execution used Node.js 24.19.0; CI status is a separate check on the saved commit.

Screenshots produced by the browser gate are `analysis-evidence.png`, `analysis-comparison.png`, `analysis-resources.png`, and `analysis-mobile.png`. The CI artifact includes these screenshots and analysis outputs.

## Problems found and resolved during implementation

1. **A target alias alone was insufficient.** Internal targets now require a matching rendered Service and endpoint port. External targets remain explicitly declared catalog evidence.
2. **Collector failure could retain supplied data.** Failed collections now establish neither presence/absence nor runtime support; stale fixture content cannot masquerade as a successful collection.
3. **Duplicate bean names were ambiguous.** They now produce unknown eligibility and preserve both supporting candidates.
4. **A single status mixed different questions.** Eligibility, target resolution, runtime support, consistency and assessment freshness now remain separate.
5. **Working-tree SHA could imply false provenance.** Working-tree bytes are explicitly labeled and hashed; immutable Git object analysis is available through `--revision`.
6. **Readiness is not spec drift.** Image-field comparison and rollout health are separate. Replica differences are informational until ownership is known.

## What remains deliberately bounded

The implemented scope is documented in [model-v2.md](model-v2.md). These are important limits for the next decision:

- Synthetic inputs only; one repository and selected revision per run. No branch discovery or multi-repository revision vector yet.
- One chart per config and a fixed Helm version. Supported resource inventory covers Deployment, Service and ConfigMap; unsupported kinds/hooks remain diagnostics and raw rendered output.
- Explicit Spring factory patterns only. The parser reads real Java syntax, but does not prove application reachability, compile/run Spring, or support general injection/registration conventions.
- Reviewed ordered YAML plus rendered `SPRING_APPLICATION_JSON`; unknown configuration sources make resolution incomplete. This is not a full Spring Environment implementation.
- Multiple resource instances are representable; selecting properties for multiple instances of the same logical caller remains unresolved.
- Gateway attribution stops at the gateway. No backend route is inferred without a future route adapter.
- Observations are supplied synthetic JSON. No ArgoCD, live Kubernetes, telemetry or verified release-provenance collector is connected.
- The existing skill still maintains v1 simulation configuration. Autonomous v2 onboarding and override workflows have not been implemented or evaluated.

## Recommended next direction

Proceed to **D06: onboarding validation**, using a second unfamiliar synthetic repository layout. Measure whether configuration changes are enough to onboard it, which patterns need extractor changes, and which outputs remain unresolved. Do not measure success only by whether a graph appears.

The next acceptance target should be a reviewed configuration proposal with evidence for selected source files, environments, workload mapping and aliases, followed by a deterministic run without AI. Extend the parser only for patterns that this exercise actually needs.

After that, introduce one internal read-only deployment adapter and release-metadata binding. Keep source/config analysis useful when those inputs are unavailable. Add per-instance resolution and gateway routes before advertising general microservice discovery.

## Reproduce

```bash
npm ci --ignore-scripts
# Install Helm v3.17.3 on PATH, or set HELM_BIN for the analysis CLI.
npm run check:analysis
npm run dev
# Open http://127.0.0.1:4173/?view=analysis

npm run verify
npm run check:helm
```

For exact source capture, use `npm run analyze -- --revision HEAD`. For the intentionally stale demo observation, use `npm run analyze -- --at 2026-09-17T03:00:00Z`. The original demo remains at the root page.
