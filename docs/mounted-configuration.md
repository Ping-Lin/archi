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

1. Profile-aware ConfigData loading, with independent Boot parity cases before widening completeness.
2. Explicit unsupported-source diagnostics for real project onboarding; do not treat
   arbitrary Java/Kotlin client factories as proven by the property parser.
3. More Boot versions and actual project specimens. Reviewed AI source mappings
   remain distinct from deterministic source extraction.

References: [Kubernetes volumes](https://kubernetes.io/docs/concepts/storage/volumes/),
[Spring external configuration](https://docs.spring.io/spring-boot/3.5/reference/features/external-config.html).

## Mounted imports: opt-in /7

`spring-properties/7` preserves /6 behavior and adds explicitly bound relative import
trees within the captured projection table. /6 still rejects imports in mounted files.

```json
{
  "adapter": "spring-properties/7",
  "environmentBindings": [],
  "importProfilePolicy": "no-variants-reviewed",
  "importBindings": [],
  "mountedFiles": ["/etc/app/application.properties"],
  "mountedImportBindings": [
    {
      "from": "/etc/app/application.properties",
      "location": "routing.properties",
      "file": "/etc/app/routing.properties"
    }
  ]
}
```

The mounted application file contains `spring.config.import=routing.properties`.
`mountedFiles` lists additional-location roots, **not every imported file**.
`mountedImportBindings` uses absolute container paths; `importBindings` continues to
use repository-qualified refs for the independent repository-file tree.
Both the declaring file and target must exist in captured ConfigMap projections.
The target must equal the declaring file's directory plus the literal relative
location: bindings cannot redirect imports to another runtime path.

Each declaring file loads before its imports; imports load in listed order and
may recursively import other reviewed files. Later roots override earlier trees;
env and application JSON still override files. Optional imports are supported only
when the file is captured and explicitly bound. No missing file is assumed absent.

The existing import resolver is reused, including its 128-file, depth-16 and
64-import-per-document limits. Cycles, duplicate/shared loads, unused bindings,
profile variants, parent traversal, URLs, file/classpath/configtree schemes and
dynamic locations stay incomplete. Every projected file must be a reviewed root or
participating binding input. No filesystem reads, network fetches or cluster calls
are authorized by an import string.

Candidate explanations include both `configuration.mount` and `configuration.import`
facts. File values retain render evidence and the import source hashes. The UI's
**Configuration imports** panel displays container paths for this tree; `bound` is
not a runtime availability or whole-scope completeness claim.

```bash
node scripts/mounted-config-fixture.mjs artifacts/mounted-imports-demo --imports
npm run analyze -- --root artifacts/mounted-imports-demo --system accepted.json --out ../analysis
```

The additional synthetic scenario requires the imported ConfigMap file to resolve
the QA gRPC host. Independent Boot cases cover bound, nested, ordered, optional-present,
optional-missing and environment-over-import behavior. These still use temporary
ordinary files and do not establish Kubernetes projection correctness.

## Mounted profiles (opt-in /9)

`spring-properties/9` combines /8 repository profiles with /7 mounted imports.
Select `importProfilePolicy: "explicit-variants-reviewed"`, retain /8
`profileBindings`, and add `mountedProfileBindings` alongside `mountedFiles` and
`mountedImportBindings`:

```json
{
  "mountedFiles": ["/config/application.properties"],
  "mountedImportBindings": [],
  "mountedProfileBindings": [
    {
      "from": "/config/application.properties",
      "profile": "qa",
      "file": "/config/application-qa.properties"
    }
  ]
}
```

This is a configuration fragment, not a complete manifest. Every reached mounted
base/import file needs one binding for each active profile (or `default` when no
profile is active). `file: null` is explicit reviewed absence, not a missing-file
fallback. A projected conventional variant contradicting that declaration blocks
complete resolution. Unknown or unused files and bindings remain incomplete.

Non-null targets must equal the exact profile-specific **container** path, including
extension. ConfigMap key remapping and `subPath` are resolved before this check;
arbitrary repository-to-file remapping is not permitted for mounted profile paths.
The additional-location variable continues to list only ordered base paths, not
variants. Profile order must match the rendered active-profile environment variable.

Mounted sources override repository sources; mapped environment and application
JSON override both. Profile and import facts retain the rendered workload/ConfigMap
evidence as well as file-content evidence. No container filesystem or cluster is read.
Previous adapters remain unchanged. Secret/projected volumes, multi-document
activation, profile groups/includes and general location discovery remain unsupported.

Reproduce the synthetic cross-repository fixture with:

```bash
node scripts/mounted-config-fixture.mjs artifacts/mounted-profiles-demo --profiles
npm run analyze -- --root artifacts/mounted-profiles-demo --system accepted.json --out ../analysis
```

The fixture deliberately resolves its QA endpoints only through the mounted profile
file; production remains unreviewed. Tests cover dirty-input isolation, deterministic
snapshots, render provenance, and suppression of edges when a binding is missing.
