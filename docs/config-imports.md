# Explicit ConfigData import bindings

`spring-properties/5` extends /4 with a bounded, explicitly bound import tree.
It supports `spring.config.import` in reviewed properties/YAML files, ordered
relative file locations, nested imports and optional imports whose files are present.
It is not a complete Spring ConfigData implementation. Earlier adapters are unchanged.

```json
{
  "adapter": "spring-properties/5",
  "environmentBindings": [],
  "importProfilePolicy": "no-variants-reviewed",
  "importBindings": [
    {
      "from": {"repository":"application","path":"application.properties"},
      "location": "routing.properties",
      "file": {"repository":"deployment","path":"config/qa/routing.properties"}
    }
  ]
}
```

The declaring file must contain `spring.config.import=routing.properties` and be
listed in the instance's `propertyFiles` or reached through another import binding.
Each binding matches the declaring file and exact trimmed location token. It maps
runtime configuration layout to approved repository input; this mapping is an
operator assertion, not proof of a mounted path or packaged classpath layout.
The target repository is pinned with the normal full commit SHA.

All declared import inputs enter capture, file provenance and revision-vector locks.
Unsafe repository paths, missing Git blobs, symlinks, unknown repositories and duplicate
bindings fail manifest validation/capture. No path is read merely because an import
string mentions it. Imports do not authorize network requests or cluster access.

## Resolution rules

The declaring file is applied first, then its imported files in declaration order;
later imports override earlier ones. Each imported file can have its own imports.
Subsequent reviewed root files override the preceding tree. Effective environment,
application JSON and bounded placeholders are applied afterward using /4 semantics.
All participating files must match the import's properties versus YAML format.

Supported tokens are relative `.properties`, `.yaml` and `.yml` file paths, optionally
prefixed with `optional:`. Exact binding is mandatory even for optional inputs.
An unavailable optional file does not prove absence from the runtime filesystem;
it remains incomplete, not a fallback. Never list an imported file a second time
as a root merely to force it into precedence.

`importProfilePolicy: "no-variants-reviewed"` explicitly asserts that no automatic
profile variants are relevant to these inputs. Set `propertiesComplete: false` when
this has not been verified. Known captured profile variants contradicting the policy
are rejected as incomplete; uncaptured files cannot be discovered by this adapter.
This policy does not perform a Spring classpath or container filesystem inventory.

Unsupported: profile variant loading, multi-document activation, repeated/shared
imports (Spring's deduplication semantics), cycles, dynamic placeholders in locations,
absolute/`file:`/`classpath:` locations, URLs, configtree, env imports, wildcard paths,
extension hints, parent traversal, and imports supplied through env/application JSON.
Unused bindings are incomplete so stale or misspelled declarations cannot be ignored.
Traversal is bounded to 128 unique files, depth 16 and 64 imports per document.

## Evidence and UI

`configuration.import` facts record the declaring file, original location, bound
target, optional flag and binding status. Their evidence references both pinned
files. Candidate explanations include these facts and each property override.
The **Configuration imports** panel displays the chain; `bound` describes a mapping,
not a successful complete traversal or live file availability. Diagnostics retain
parse, cycle, duplicate and scope failures. No incomplete scope produces an edge.

## Reproduce and verify

```bash
node scripts/config-imports-fixture.mjs artifacts/imports-demo
npm run analyze -- --root artifacts/imports-demo --system accepted.json --out ../analysis
npm run dev
npm run test:spring-boot
```

The fixture composes imports with rendered ConfigMap env, placeholders and gRPC.
All inputs and review declarations are synthetic. QA has configured portal → orders
edges; production stays unreviewed with an opaque Secret reference. Dirty imported
working-tree bytes do not override the pinned Git revision.

The real Boot 3.5.6 / Java 17 compatibility gate covers bound imports, ordered imports,
nested imports, optional present imports, env override and optional missing behavior.
The previous /4 unsupported-import case remains to prevent silent compatibility changes.
See [compatibility gate](spring-boot-compatibility.md).

Framework reference: [Spring Boot ConfigData imports](https://docs.spring.io/spring-boot/3.5/reference/features/external-config.html).
Mounted ConfigMap file inputs are available through [/6](mounted-configuration.md).
Mounted-file import bindings are available through /7 in the same guide.
Repository-backed profile-aware import graphs are available through
[/8](profile-configuration.md). Mounted profiles, broader ConfigData discovery and
Boot version/application validation remain pending. No general production-compatibility claim is made.
