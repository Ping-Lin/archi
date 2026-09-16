# Optional local Kubernetes deployment

This is a manual local-cluster exercise, not performed by setup or preview. Requires
Docker, kind, kubectl and Helm 3. Generated production image references deliberately
use `example.invalid`; they cannot pull and are intended for inspection only.

Build the shared mock image and load it into your chosen kind cluster:

```bash
docker build -t archi-mock:dev -f src/mock/Dockerfile .
kind load docker-image archi-mock:dev --name YOUR_KIND_CLUSTER
```

Create local override files without changing the authored fictional versions:

```bash
node scripts/local-values.mjs
```

This writes `artifacts/local-helm/*.yaml`, replacing every image with
`archi-mock:dev` and replicas with one. Review those files and render first:

```bash
helm template commerce charts/project -n archi-dev -f artifacts/local-helm/commerce.yaml
```

When ready, explicitly choose your local context and install all three projects:

```bash
helm upgrade --install commerce charts/project --kube-context kind-YOUR_KIND_CLUSTER \
  -n archi-dev --create-namespace -f artifacts/local-helm/commerce.yaml
helm upgrade --install fulfillment charts/project --kube-context kind-YOUR_KIND_CLUSTER \
  -n archi-dev -f artifacts/local-helm/fulfillment.yaml
helm upgrade --install platform charts/project --kube-context kind-YOUR_KIND_CLUSTER \
  -n archi-dev -f artifacts/local-helm/platform.yaml
kubectl --context kind-YOUR_KIND_CLUSTER -n archi-dev rollout status deployment/gateway
kubectl --context kind-YOUR_KIND_CLUSTER -n archi-dev port-forward service/gateway 8100:8080
# In another terminal:
curl http://127.0.0.1:8100/simulate
```

No Ingress is necessary for this exercise. Service-to-service calls remain inside
the namespace. Cleanup by uninstalling the three releases from that explicit local
context; do not delete a shared namespace.
