# Rendered ConfigMap environment bindings

Select `spring-properties/4` on the deployment instance. /1, /2 and /3 keep their
previous boundaries. This additive adapter supports `env[].valueFrom.configMapKeyRef`
and ordered `envFrom[].configMapRef`, including prefixes, from captured Helm renders.
No cluster reads, polling, automatic downloads or ambient process variables occur.

```json
{
  "adapter": "spring-properties/4",
  "environmentBindings": [
    {"name":"ROUTING_HOST","key":"gateway.peer.host"},
    {"name":"PEER_PORT","key":"gateway.peer.port"}
  ]
}
```

In the bound Deployment's single application container:

```yaml
envFrom:
  - prefix: ROUTING_
    configMapRef:
      name: route-defaults
env:
  - name: PEER_PORT
    valueFrom:
      configMapKeyRef:
        name: route-overrides
        key: port
  - name: SPRING_PROFILES_ACTIVE
    value: qa
```

The example expects `route-defaults.data.HOST` and `route-overrides.data.port`.
Each resulting application environment name must have an explicit mapping.
`SPRING_PROFILES_ACTIVE` and `SPRING_APPLICATION_JSON` retain their special handling;
they can also come from supported ConfigMap references. Values must be strings.
An empty string is present, not absent. Only conservative shell-style environment
names (`[A-Za-z_][A-Za-z0-9_]*`) are supported in this adapter.

## Scope and precedence

References match exact cluster + namespace + name in the pinned rendered inventory.
Different releases in the same namespace can provide a ConfigMap; duplicate resource
ownership remains a composition error. No same-name fallback crosses a namespace
or cluster. A reference does not prove that resource currently exists in Kubernetes.

Environment construction follows ordered envFrom (last value wins), then explicit
env overrides. Duplicate explicit env names are rejected as incomplete. Property
precedence remains reviewed files → explicitly mapped effective environment →
application JSON → bounded exact-key placeholder resolution.

Missing resources/keys, malformed references, unsupported fieldRef/resourceFieldRef,
unmapped environment variables, mounts, command/args, or unresolved Secret sources
keep the scope incomplete. This is conservative even when another override could
hide the missing input. `optional: true` does not establish absence: the render is
not a closed inventory of the running cluster or image environment. No default is
evaluated while source scope is incomplete.

The model follows the [Kubernetes Pod environment precedence contract](https://kubernetes.io/docs/reference/kubernetes-api/core/pod-v1/).
It implements a bounded subset, not API-server validation or kubelet execution.

## Evidence and Secret handling

`configuration.reference` facts retain the resource identity, requested key,
optional flag and resolution status. Their evidence links to the workload and
ConfigMap render; all reference facts are included in candidate explanations,
including failures and overridden envFrom sources. Effective property values
carry supporting reference fact IDs. The UI shows **Rendered configuration references**.

Secret references (`secretKeyRef`, `envFrom.secretRef`) are recognized as opaque.
They do not load or decode Secret data, and prevent confirmed dependencies while
configuration is incomplete. This is reference visibility, **not Secret value support**.
Standard v1 Secret documents are now exported as identities plus `archi.redacted: true`;
data, stringData and other metadata are removed, including Secrets inside List items.
This applies to analysis JSON manifests and rendered YAML exports. Input/render
hashes still identify the original bytes; exported YAML is no longer byte-identical
when redaction occurs. Historical exports are not rewritten automatically.

This is not a universal credential detector. Do not place credentials in ConfigMaps,
literal env, custom resources, source citations or values intended for display.
Approved local source/chart inputs and temporary Helm processing still contain their
original bytes. Secret acquisition and secure value resolution are separate future work.

## Reproduce

```bash
node scripts/configmap-fixture.mjs artifacts/configmap-demo
npm run analyze -- --root artifacts/configmap-demo --system accepted.json --out ../analysis
npm run dev
```

Requires Git, Node 22+, dependencies and Helm v3.17.3. Destination must be new.
The authored fixture combines envFrom, key references, application JSON, placeholders
and reviewed gRPC candidates. QA maps portal to orders; production remains unreviewed
and has an opaque Secret reference with a fake marker to verify export redaction.
Reviews are explicitly synthetic; no actual human approval or deployment is claimed.

Still unsupported in /4: mounted ConfigMap files, binaryData, Spring ConfigData imports,
automatic profile file discovery, external Secret stores and custom configuration loaders.
The additive [/5 adapter](config-imports.md) supports a separate bounded file-import contract.
