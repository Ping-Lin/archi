# Archi

New here? Read [Using your existing charts](docs/adoption-guide.md), or click
**How to use** in the app for the animated walkthrough. `/?view=acceptance` provides
T0–T6 CD scenarios, offline acceptance-bundle import/export and capture comparison.
The guide includes bundle creation/replay commands and separates implemented
one-shot runtime capture from the proposed future LIST/WATCH + SSE live mode.

Cross-repository analysis is available through a pinned system manifest:
[implemented contracts and usage](docs/model-composition.md),
[phase four findings](docs/phase-four-report.md).

Deployment runtime enrichment compares the selected repository render, captured
workload spec and observed Pods without changing static topology. See
[runtime setup and QA](docs/runtime-enrichment.md) for the synthetic walkthrough,
read-only collector, scope/identity rules and remaining live-cluster acceptance.
The independent [traffic layer](docs/traffic.md) retains Istio/OTLP observations.

A local architecture workspace connecting **logical services → deployment contexts → evidence**.
The first version is a complete fictional commerce sandbox: 3 projects, 8 services,
3 contexts, 24 deployment instances and a reusable configuration skill.

The evidence workspace also supports multiple analyzed callers in one captured
Helm environment. Run `npm run analyze:system`, then open `/?view=analysis` to
inspect the synthetic storefront → orders → inventory chain, caller-scoped
evidence and QA/production differences. See [phase three findings](docs/phase-three-report.md)
for validation and the remaining system boundary.

## Run

Requires Node.js 22+. The original demo has no npm installation or CDN requirement.
The new analysis workspace additionally requires `npm ci` and Helm v3.17.3.

```bash
git clone https://github.com/Ping-Lin/archi.git
cd archi
git checkout feat/architecture-poc
npm run dev
# Open http://127.0.0.1:4173
```

Start the explorer and all eight HTTP simulators:

```bash
npm run demo
curl http://127.0.0.1:8100/simulate
```

Stop with Ctrl+C. Local servers bind to loopback. If a port is occupied the command
fails and closes servers it already started. The explorer is read-only; edit the
authored configuration to change the model.

## Explore

Open **Evidence lab** in the sidebar to inspect the new source-analysis slice:

```bash
npm ci --ignore-scripts
npm run check:analysis
npm run dev
# http://127.0.0.1:4173/?view=analysis
```

It reads real Helm output and parsed synthetic Java source, evaluates clients A/B/C
independently in dev/prod, and exposes the supporting facts, exclusions and unknowns.
The Service graph visualizes resolved dependencies from the selected environment;
select a connection or excluded candidate to inspect its evidence. Try the second
repository layout with `npm run analyze:logistics`, then refresh. Restore checkout
with `npm run check:analysis`.
Use `npm run analyze -- --revision HEAD` for immutable Git inputs. This is bounded
synthetic analysis, not production discovery. See [the v2 analysis contract](docs/model-v2.md).

The original demo includes:

- **System / L1:** project boundaries and aggregated cross-project dependencies.
- **Services / L2:** inspect nodes, ownership, relationships and source links.
- **Deployments / L3:** choose an environment and inspect desired versus observed state.
- **Environments:** compare versions, replicas and known revisions across contexts.
- Search, project filters, neighbor focus, zoom and JSON snapshot export.
- Responsive inspector and a guided walkthrough via the `?` button.

Try Payment Adapter in Production East for image/readiness drift, compare Production
East and West for orders/inventory version differences, and inspect Notification
Worker for missing source revision evidence. All observations are dated fixtures,
not live health. Example URLs intentionally use reserved example domains.

## One configuration, all outputs

Edit `config/system.json` and `config/observations.json`, then:

```bash
npm run generate
npm run verify
npm run check:helm  # requires Helm 3; fails explicitly when missing
```

Or ask an agent to use `$archi-system-design`, located in
`.agents/skills/archi-system-design`. Its deterministic setup entrypoint is:

```bash
node .agents/skills/archi-system-design/scripts/setup.mjs --root .
# In a Helm-equipped environment:
node .agents/skills/archi-system-design/scripts/setup.mjs --root . --require-helm
```

Agents without project skill discovery can read that `SKILL.md` directly. Skill
creation here does not install it globally or alter your other agent configuration.

Generated files are owned by `generated/manifest.json`; do not edit them manually.
`npm run check` detects stale or edited outputs. Authored observations never get
rewritten to hide drift.

## Helm and mock projects

`charts/project` is one reusable project chart. Nine generated values files cover
three projects × three contexts. Each project descriptor and service descriptor
under `examples/projects` represents a future independent repository boundary.
The mock runtime is shared deliberately; these folders are not separate Git repos
and do not implement real commerce behavior.

```bash
helm lint charts/project -f generated/helm/prod-east/commerce.yaml --strict
helm template commerce charts/project \
  --namespace archi-prod -f generated/helm/prod-east/commerce.yaml
```

Images in the model are fictional. To run the actual simulation containers locally:

```bash
docker compose up --build
# Explorer runs separately with npm run dev.
```

All mock services implement `/healthz`, `/info` and `/simulate`. gRPC and AMQP edge
labels are architectural intent; the demo implements HTTP calls only. Async broker
behavior, persistence and real downstream APIs are outside this version.

To use a local Kubernetes cluster, first build/load a real mock image and override
the fictional image references. See [local Kubernetes setup](docs/local-kubernetes.md).
No cluster is contacted by generation, validation or local preview.

## Implementation

| Area | Choice |
|---|---|
| Frontend | Vue 3.5.13, component ES modules, CSS design tokens, SVG graph |
| Tooling and runtime | Node.js built-ins, native test runner, ES modules |
| Configuration | Versioned JSON contract with semantic validation |
| Deployment | Helm 3 chart + generated values + Docker Compose |
| Reusable workflow | Repo-local `archi-system-design` skill |

Vue is vendored with its MIT license for reproducible offline preview. The application
uses the production runtime/compiler without a bundler; see [design decisions](docs/architecture.md)
for the migration path to Vite as the UI grows.

## Verification

`npm run verify` checks generated drift and runs v1/v2 contract, generation, Vue template
compilation, HTTP runtime and static server tests. It also runs an isolated ninth-service
extension through the setup skill. `npm run check:helm` lints and
renders every context/project. GitHub Actions also runs browser interactions and
uploads desktop/mobile screenshots as `architecture-previews`. Analysis integration
tests require Helm; local skips are reported explicitly and CI rejects a missing Helm gate.
`npm run check:analysis` validates against the independently authored A/B/C oracle.

For the optional browser gate locally:

```bash
npm install --no-save --package-lock=false playwright@1.51.1
npx playwright install chromium
npm run dev  # separate terminal
node tests/browser.mjs
```

Read [the model](docs/model.md), [architecture and roadmap](docs/architecture.md),
and [review checklist](docs/review.md) for scope, trade-offs and next decisions.
