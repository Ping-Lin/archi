# Architecture contract — archi/v1alpha1

## Identity and relationships

| Concept | Current representation | Identity / invariant |
|---|---|---|
| Node | project or logical service | stable ID independent of runtime/version |
| Edge | declared dependency | source → target, protocol, purpose, evidence |
| Context | deployment scope | environment + cluster + namespace |
| Deployment instance | service in a context | one instance per service/context in v1 |
| Evidence | origin of a claim | declared, observed or inferred; named source |
| View | projection of the model | L1 project, L2 service, deployment |
| Observation | dated snapshot of an instance | image, ready replicas, optional known revision |

`config/system.json` is authored intent. `config/observations.json` is an independent
snapshot. `web/data.json` is derived, never another source of truth.

IDs are lowercase DNS-compatible strings of at most 48 characters. Service IDs are
globally unique so generated Kubernetes Service names and cross-project DNS are
unambiguous. In v1 each project is installed once per namespace with release name
matching its project ID. Supporting multiple releases of the same service in one
namespace requires a new instance/endpoint identity contract.

## Services

A service contains `id`, `name`, `description`, `project`, `layer`, `port` and
`repoPath`. Local ports are distinct (1024–65535). Layers are `edge`, `domain` or
`integration`; visual arrangement is a view concern, not a dependency inference.
The repoPath is `services/<id>` in the simulated project boundary.

A dependency records `source`, `target`, `protocol`, `label` and an evidence ID.
Protocols accepted by the model are HTTP, gRPC, AMQP and TCP. The runtime is an
HTTP dependency simulator regardless of this label. Cycles in declared architecture
are allowed, but runtime traversal detects visited services and limits depth.

## Contexts and deployments

A context contains `id`, `name`, `environment`, `cluster`, `namespace`.
A deployment references a service and context and declares an image repository/tag,
replicas (0–100), sourceCommit, evidence and HTTPS links. Every deployed dependency
source must have its target deployed in the same context in v1. External endpoints
need an explicit future node/endpoint extension rather than a guessed DNS name.

Image tags are opaque labels. A branch, tag, chart version and commit are distinct
identities. `sourceCommit` is a full 40-character lowercase Git SHA or **null**.
Do not infer a SHA from an image tag. The model does not yet support digest-based
image identity, rollout generations, canary releases or shared external services.

## Observations and drift

An observation references exactly one known deployment and contains an ISO timestamp
with timezone, an image repository/tag, readyReplicas, sourceCommit and observed
evidence. Duplicate observations are rejected; a future collector must select or
store a timestamped history before building the latest snapshot.

The projection reports:

- `unknown`: no observation exists.
- `drift`: image differs, ready replicas differ from desired, or both known source
  revisions differ.
- `aligned`: those comparisons match; this is not proof of live health or identical
  source code when revisions are unknown.

Readiness difference may represent a normal rollout. An old snapshot is not current
health. The inspector shows its timestamp. No collector is connected in this PoC.

## Evidence

`declared` means an authored statement; `observed` means a supplied snapshot;
`inferred` is reserved for future candidate relationships. Every evidence record
contains a stable ID, kind, source and explanation. Both current sources are explicitly
fictional. Generated values preserve sourceCommit annotations; an empty annotation
means unknown and must not be interpreted as an observed revision.

## Validation boundaries

`src/core/model.mjs` is the executable semantic validator. It rejects broken
references, ambiguous deployments, unsafe URL schemes, conflicting ports, unknown
protocols and malformed observations. `charts/project/values.schema.json` validates
the Helm interface independently. Unknown application metadata can be added without
changing the generator, but new operational meaning requires validator and test changes.

Generation is deterministic. The ownership manifest enumerates the only outputs that
may be removed on regeneration. Source files, chart templates and observations are
never removed by the generator.
