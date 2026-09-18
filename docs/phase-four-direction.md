# Accepted direction — analysis contracts and cross-repository composition

Date: 2026-09-17
Status: Direction accepted by Ping. The first implementation is documented in
[model-composition.md](model-composition.md); remaining scope is tracked in
[phase-four-report.md](phase-four-report.md). The original decision follows.

This decision supersedes the onboarding-first sequence in the phase-three report.
The next milestone is to formalize analysis contracts and system composition,
then evaluate onboarding against an unfamiliar fixture. The existing single-repo,
shared-chart implementation remains a validated vertical slice, not the intended
system boundary.

## Identity and system boundary

Model repository, project, logical service, deployment instance and Helm release
as separate concepts. Do not assume one-to-one relationships between them.

| Concept | Responsibility |
| --- | --- |
| Repository | Source/configuration location and explicitly pinned revision |
| Project | Ownership and logical grouping, potentially spanning repositories |
| Service | Stable logical identity, independent of deployment and revision |
| Deployment instance | A service within a particular deployment scope |
| Helm release | Rendered resources for an explicit cluster/namespace/release context |

Source code and deployment configuration may live in different repositories.
Helm supplies deployment/configuration evidence; a chart is not the system boundary.
Retain explicit ownership and identity mappings rather than deducing identity from
matching repository, chart, release or service names.

## Three analysis contracts

| Contract | Owns | Must expose |
| --- | --- | --- |
| Adapter | Supported input extraction, such as Spring factories or Helm resources | Version, accepted inputs, normalized facts, source evidence, diagnostics and coverage |
| Binding | Repository paths, workloads and property sources mapped to stable service identities | Declarative mappings, scope and reviewed assumptions in archi configuration |
| Resolution | Environment-scoped interpretation of facts and bindings | Versioned rules, input evidence, resolved/ambiguous/unknown outcomes and reasons |

Keep framework-specific semantics in versioned adapters/rules. Configuration
describes bindings and inputs; it must not become an arbitrary executable rule
language or a manually authored dependency list. New Kotlin or gRPC patterns may
require new adapters rather than additional path mappings.

Reuse the existing extractor logic, evidence ledger and UI where possible. Refactor
orchestration so one analysis run no longer means one repository plus one chart.
The exact executable schemas and adapter interfaces are the next design deliverable;
this document does not claim that they already exist.

## Cross-repository composition

Introduce a system manifest that declares repositories, pinned source/config
revisions, project/service ownership and per-environment deployment bindings.
The analysis lock records a revision vector, not one shared branch or inferred SHA.

For example, storefront source at repository A/commit A, orders source at
repository B/commit B and deployment configuration at repository C/commit C may
jointly describe staging. Each input keeps its provenance and role.

Analyze independently scoped inputs, then compose their facts/snapshots within
the selected environment. Resolve a caller endpoint to a deployment instance and
then its logical service using explicit bindings and supported evidence such as
cluster, namespace, Service/DNS and port. Matching a service name alone is
insufficient. Project grouping must not prevent relationships across projects.

Preserve unresolved endpoints and ambiguous alternatives. Keep external targets
distinct. Gateway resolution stops at the gateway unless a supported route adapter
provides backend evidence. Source/config analysis does not establish live traffic.
Without deployment provenance, source-to-release correspondence stays unverified;
never infer commits from image tags or assume all repositories share a revision.

## Skill responsibility

The onboarding skill locates approved inputs, proposes bindings with reasons,
reports unsupported patterns and invokes deterministic analysis for validation.
It does not independently generate the authoritative dependency graph. Human
review remains necessary for mappings and completeness assumptions that cannot
be established from available evidence.

## Delivery order and acceptance

1. Define executable adapter, binding, resolution and composition schemas, including
   identity, evidence references, versioning and compatibility with current configs.
2. Refactor current analysis behind those contracts while retaining existing oracles.
3. Add a synthetic cross-repository fixture with independently pinned source and
   deployment-config revisions, separate releases and cross-project dependencies.
4. Verify same-name services in different scopes do not merge, missing or ambiguous
   bindings remain explicit, one repository's revision can change independently,
   and repeated runs over the same locked inputs produce identical semantic results.
5. Update onboarding guidance and evaluate it using a separately prepared unfamiliar
   fixture with withheld expectations; measure mapping errors and manual corrections.

Dense-graph visualization and broader framework support follow these contract and
composition gates. No live deployment, merge or PR is authorized by this direction;
continue saving reviewable changes on feat/architecture-poc under the existing policy.
