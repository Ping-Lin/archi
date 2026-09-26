# Using Archi with your existing charts

## Start in the correct workspace

The authored Architecture demo is fictional, not the required format for your chart.
Evidence lab uses the deterministic source/Helm analysis pipeline. Deployment scenarios
is a separate synthetic learning/acceptance workspace. The **How to use** button on
each page opens a six-step animated guide with optional playback, pause, previous/next,
keyboard dismissal and reduced-motion support.

## Your chart does not need to look like the demo

The system pipeline calls Helm on your chart and ordered values files, then inspects
the rendered resources. It does not read a fixed `.Values.services` or `.Values.image`
shape. Custom values keys, helper templates and directory conventions are configuration
differences, provided the captured chart renders deterministically with supported inputs.

| Your input | Archi mapping |
| --- | --- |
| Local source/config repositories | `repositories[]`: root path and exact commit SHA |
| Logical service ownership | `projects[]`, `services[]` |
| Existing chart directory | `environments[].releases[].chart` |
| Ordered CD values files | `environments[].releases[].values[]` |
| Release, cluster, namespace | Each environment's explicit release scope |
| Rendered Deployment / Service | Instance `workload` and `endpoint` bindings |
| Java client construction / properties | Source adapter inputs and instance property/profile policy |

Use the full schema/field guide in [model-composition.md](model-composition.md).
For another environment, add its releases and instances with its own namespaces,
values files, profiles and property inputs. Do not infer environment from branch names.
The current manifest owns a single repository revision vector; use separate manifests
when environments require different source/config commits.

The release fragment below is illustrative, not a complete runnable manifest:

```json
{
  "id": "orders-qa", "cluster": "commerce", "namespace": "sales-qa",
  "name": "orders", "adapter": "helm-template/1",
  "chart": {"repository": "deploy", "path": "helm/orders"},
  "values": [
    {"repository": "deploy", "path": "values/common.yaml"},
    {"repository": "deploy", "path": "values/qa.yaml"}
  ],
  "helmVersion": "v3.17.3", "kubeVersion": "1.30.0", "apiVersions": []
}
```

Replace capabilities with the values actually used by the selected rendering context.
Real source analysis requires `simulation: false` in the system manifest; the older
single-repository simulation config and v1 generator remain synthetic-only. This
supersedes the blanket synthetic-only wording in the earlier onboarding reference.

```bash
npm ci --ignore-scripts
# Install the pinned Helm v3.17.3 binary separately.
npm run analyze -- --root /approved/workspace --system system.json \
  --out /path/to/archi/artifacts/analysis
npm run dev
# Open http://127.0.0.1:4173/?view=analysis
```

### Important compatibility limits

- Static inventory currently interprets Deployment, Service and ConfigMap resources.
  Unsupported kinds/hooks produce diagnostics. Ingress, mesh routes, operators,
  StatefulSets and Jobs are not generalized by merely renaming config fields.
- The render interface currently exposes values files, not arbitrary CLI arguments.
  Inline `--set`, Argo CD overrides, Helmfile, plugins, post-renderers and external
  secrets must be explicitly accounted for. Do not claim CD equivalence when omitted.
- Dependencies must be present in approved captured input; this workflow does not
  fetch remote chart dependencies. Binary packaged dependencies need compatibility
  verification with the text-based Git capture layer; do not assume support.
- Live `lookup` results are not available during the local render. Random/time-dependent
  templates that produce different output on two runs are rejected.
- Source dependency extraction currently supports bounded explicit Java Spring bean
  patterns. Kotlin/gRPC or dynamic client factories may require new adapters even when
  Helm rendering works. A successful render is not complete architecture discovery.

To assess a new project, obtain a redacted chart tree, representative values files,
the actual CD render command/overrides, and a rendered Deployment/Service example.
Then separate mapping-only changes from unsupported rendering or parsing semantics.
No cluster credentials or secret values are needed for that first assessment.

## Runtime: implemented behavior versus future live transport

Today the collector is an explicit, one-shot, read-only kubectl inventory operation.
It performs paginated namespace lists for Deployments, ReplicaSets and Pods, projects
allowlisted fields, and saves a capture. Import performs deterministic reconciliation
and updates an analysis file. The browser fetches that file on page load; its 30-second
timer only updates the displayed freshness. It does not query Kubernetes or refresh
the capture. There is no automatic polling, Kubernetes watch, SSE or WebSocket yet.

See [runtime-enrichment.md](runtime-enrichment.md) for explicit context/kubeconfig,
namespace arguments, RBAC and import commands. Production without inventory access
can still use static analysis; missing runtime evidence must stay unknown.

For a future live mode, keep the two transport boundaries separate:

1. Collector → Kubernetes: initial namespace-scoped LIST, then WATCH from the returned
   resourceVersion, with reconnection/backoff and relist after expired history (410).
   Credentials stay in the collector, never in browser JavaScript.
2. Collector → reconciliation: debounce/coalesce resource changes into bounded dated
   observations. Preserve per-kind coverage and disconnection/stale states; watches
   across resource kinds do not make an atomic cross-kind snapshot.
3. Backend → UI: SSE is a suitable initial choice for one-way report notifications.
   The UI can refetch a report by version/hash. Reconnect/resync must recover missed
   notifications; WebSocket is unnecessary unless bidirectional streaming is required.

This is a proposed design, not a shipped live feature. A polling collector can be a
simpler explicit alternative where WATCH is unavailable. Actual traffic remains a
separate Istio/OTel observation source, not something Pod inventory alone establishes.

References: [Kubernetes API concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/),
[Helm v3 template](https://docs.helm.sh/docs/v3/helm/helm_template/).

## Offline scenarios and acceptance bundles

```bash
mkdir -p artifacts/acceptance
npm run runtime:acceptance -- --scenarios --out artifacts/acceptance/bundle.json
npm run runtime:acceptance -- --verify artifacts/acceptance/bundle.json
npm run dev
# Open http://127.0.0.1:4173/?view=acceptance
```

The bundle command refuses existing output files. Keep old bundles; choose a new path
and open it with **Open bundle** instead of overwriting prior evidence. Browser opening
does not upload the file. It checks hashes and displays stored reports; CLI verification
reruns reconciliation and independently checks the maintained T0–T6 oracle.

To package approved real or synthetic inputs, preserving the analysis input mode:

```bash
npm run runtime:acceptance -- --analysis PATH_TO_ANALYSIS.json \
  --capture BEFORE.json --capture AFTER.json --at 2026-09-26T12:00:00Z \
  --out NEW_BUNDLE.json
npm run runtime:acceptance -- --verify NEW_BUNDLE.json
```

Use your actual assessment time. Captured inputs have no independent oracle and show
`not-provided`, not automatic acceptance. Replay needs the same runtime source files,
package-lock and installed dependencies, but no live cluster, Helm or source repositories.
The bundle preserves source analysis and may contain sensitive names/configuration;
review and protect it before sharing. Hashes prove byte consistency, not authenticity.
Compare captures only within the same environment/cluster/input mode. Missing report
findings mean coverage differences, not proven deletion; UID changes identify recreation.
