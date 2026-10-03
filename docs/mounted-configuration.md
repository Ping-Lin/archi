# Mounted ConfigMap configuration

`spring-properties/6` adds deterministic ConfigMap file projection to /5. It uses
captured Helm output only; it neither reads a container filesystem nor queries Kubernetes.
Earlier adapters retain their behavior.

Instance configuration (field guide, not a complete system manifest):

```json
{
  "adapter": "spring-properties/6",
  "environmentBindings": [],
  "importProfilePolicy": "no-variants-reviewed",
  "importBindings": [],
  "mountedFiles": ["/etc/app/routing.properties", "/etc/app/override.yaml"]
}
```

The bound Deployment's single application container must have a literal effective
`SPRING_CONFIG_ADDITIONAL_LOCATION` equal to
`file:/etc/app/routing.properties,file:/etc/app/override.yaml`.
The value may come from the supported ConfigMap environment resolver.
Each file must map through `volumeMounts` → `volumes[].configMap` → a captured
ConfigMap in the same cluster and namespace. Mounting a file alone does not prove
Spring loads it. `mountedFiles` contains **container paths**, not local repo paths.

## Supported boundary

- ConfigMap string `data`; default key-to-file projection or explicit `items` mappings.
- Directory mounts and exact file `subPath`; `.properties`, `.yaml`, `.yml` syntax
  follows the existing bounded property parser.
- Precedence: reviewed root/import trees → ordered mounted files → explicitly mapped
  environment → `SPRING_APPLICATION_JSON` → exact-key placeholder evaluation.
- `configuration.mount` facts retain ConfigMap identity, key, volume, container path
  and render evidence. Candidate explanations and the **Mounted configuration files**
  panel expose them. `projected` means captured mapping, not successful runtime loading.

Unknown sources invalidate completeness: missing ConfigMaps/keys (including optional
ones), Secret/projected/other volumes, binaryData, subPathExpr, path traversal,
overlapping mounts or item paths, ambiguous files, malformed modes and additional
projected files not listed in `mountedFiles`. This deliberately conservative policy
also rejects unrelated mounted files until their effects can be modeled separately.

Only explicit file locations are accepted: no directories, optional locations,
wildcards, location groups, dynamic locations or implicit search paths. Imports and
profile directives **inside mounted files** remain unsupported. /5 import bindings
remain available for pinned repository files, not mounted-file import traversal.

`no-variants-reviewed` is a reviewed assumption covering these inputs too. Known
projected profile variants contradicting it block completeness. Uncaptured image
files, default classpath sources and custom property-source code cannot be discovered;
set `propertiesComplete: false` unless the actual application scope was reviewed.
Permissions, effective UID, kubelet projection/update timing, subPath staleness and
live file readability are not verified. ConfigMap contents are not secret-redacted;
never put credentials in ConfigMaps or source inputs intended for export.

## Reproduce

```bash
node scripts/mounted-config-fixture.mjs artifacts/mounted-demo
npm run analyze -- --root artifacts/mounted-demo --system accepted.json --out ../analysis
npm run dev
```

The synthetic fixture combines pinned imports, ConfigMap env, mounted properties,
placeholders and reviewed gRPC bindings. Its root/import host is intentionally
unresolvable: the mounted override is required for the QA edge. Production remains
unreviewed with an opaque Secret. No real operator approvals or observations are added.

Tests cover parsing failures, precedence, provenance and repeated semantic hashes.
The Spring Boot compatibility runner additionally compares four additional-location
cases against Boot 3.5.6 Environment and ConfigurationProperties binding. It writes
ordinary temporary files, not Kubernetes mounts; this does not validate kubelet behavior.

## Remaining deterministic work

1. Profile-aware ConfigData loading and imports from mounted files, with independent
   Boot parity cases before widening completeness.
2. Explicit unsupported-source diagnostics for real project onboarding; do not treat
   arbitrary Java/Kotlin client factories as proven by the property parser.
3. More Boot versions and actual project specimens. Reviewed AI source mappings
   remain distinct from deterministic source extraction.

References: [Kubernetes volumes](https://kubernetes.io/docs/concepts/storage/volumes/),
[Spring external configuration](https://docs.spring.io/spring-boot/3.5/reference/features/external-config.html).
