# Onboard a synthetic repository to v2 analysis

Read `docs/model-v2.md` for the supported syntax and property-source boundary.
Use the repository's `scripts/analyze.mjs`; do not generate dependency lists to
make the graph appear. The analyzer currently accepts synthetic inputs only.

## Inspect and propose

Within approved files, locate chart roots, ordered values, Java configuration
classes, literal client keys, property files and candidate environment mappings.
Record file paths and the reason for each proposed mapping. A branch name or folder
name is a hint, not proof of its deployment environment.

Propose `archi.config.json` with explicit source files, approved constructor types,
chart/capabilities, environment profiles and declared target aliases. Check each
internal target against a rendered Service/DNS/port. External endpoints remain
external catalog entries. Never invent a source SHA or a runtime observation.

`propertiesComplete: true` is a reviewed assumption, not a discovery shortcut.
Set it false when relevant external overrides or profile inputs are unavailable.
List unsupported registration, construction and configuration patterns. A graph
can be incomplete and still useful if those limits are visible.

Review the proposal before applying it to a real project. A request to construct
a synthetic demo permits routine fictional defaults; record them in the report.
Real internal source/config data stays within its approved execution boundary.

## Validate and explain

Run `npm run analyze -- --config PATH --out artifacts/analysis`. For committed
inputs, add `--revision REF`. Analyze twice and compare semantic snapshot hashes;
run times and freshness assessments may change. Inspect the service graph and
select edges plus disabled/unresolved candidates to confirm evidence navigation.

Write expected candidate dispositions independently of analyzer output. Reuse
`--oracle PATH` to validate them. Do not change expected results merely to match
the implementation. If an unsupported pattern is needed, identify the adapter
gap; do not disguise a new inference rule as configuration.

The two maintained examples are `examples/analysis/archi.config.json` and
`examples/logistics/archi.config.json`. The second demonstrates changed paths,
names, profiles and endpoint conventions with unchanged extractors. It is a
configuration portability regression, not a blinded AI-onboarding evaluation.

Report mappings, assumptions, unresolved patterns, required core changes, test
results and the deterministic rerun command. Preserve the current branch/PR
approval boundary. Do not deploy the synthetic charts.

## Multiple callers in one captured system

Use `examples/system/archi.config.json` for a shared-chart, same-repository system.
Replace `source` with `sources`; each entry has a unique logical `service`, approved
files and client types. Every environment must provide `callers` with exactly one
scope per service: profiles, property files, completeness and observation path.
Do not inherit one service's runtime observations or property policy into another.
Observation files are caller-scoped; a shared unqualified event file is rejected.

The environment still owns cluster, namespace, release, values and target catalog.
Use this mode only when one captured Helm render represents that boundary. Multiple
matching Deployments remain ambiguous. Cross-repository, cross-namespace and
independent release composition require a future contract, not ID aliases.
Candidate expectations use `service/beanName` keys; retain repeated bean names and
shared Java files as separate caller identities. Run `npm run analyze:system` and
inspect both the graph and environment comparison for caller isolation.
