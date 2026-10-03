# Explicit profile-aware ConfigData

`spring-properties/8` adds profile variants to the repository-backed /5 import
adapter. It does not change /1–/7 and does not yet combine profile variants with
mounted-file adapters /6–/7.

```json
{
  "adapter": "spring-properties/8",
  "environmentBindings": [],
  "importProfilePolicy": "explicit-variants-reviewed",
  "importBindings": [],
  "profileBindings": [
    {
      "from": {"repository":"application","path":"application.properties"},
      "profile": "qa",
      "file": {"repository":"deployment","path":"config/application-qa.properties"}
    }
  ]
}
```

The instance still declares ordered `profiles`, ordered root `propertyFiles`, and
`propertiesComplete`. Every reached base file requires exactly one profile binding
per active profile. `file: null` explicitly asserts reviewed absence; it never means
that a failed read is ignored. Empty active profiles select `default`. A captured
conventional variant contradicting a null binding makes the scope incomplete.
Uncaptured runtime files cannot be discovered; operators must review the layout.

Bindings describe approved source-to-runtime mappings, not filesystem discovery.
Targets must retain the properties versus YAML format. All non-null targets and
declaring files are read from full pinned Git revisions, included in the input lock,
and attached to evidence. Dirty working-tree bytes do not affect the snapshot.

## Ordering and closed scope

The adapter first traverses a root's non-profile import tree. It then expands
profile variants in base-file discovery order, preserving declared profile order
within each base. Imports declared by variants use the same explicit import
bindings. Subsequent root trees override earlier ones. Environment and application
JSON overrides follow file resolution. Rendered `SPRING_PROFILES_ACTIVE` must match
the reviewed **ordered** list, not just its set of names.

This distinction matters: an imported profile variant can override a root profile
variant even when the latter belongs to a later active profile. The Boot comparison
gate exercises this interaction instead of assuming a simple file overlay.

Missing, duplicate, unused, inactive, format-mismatched or contradictory bindings
remain incomplete. Cycles and shared/repeated inputs are still blocked. Limits are
8 active profiles, 128 unique files, depth 16 and 64 imports per document.
Profile groups/includes/activation expressions, multi-document files, location
groups, arbitrary classpath discovery, dynamic locations and mounted profiles are
not supported. No complete scope or dependency edge is claimed for these cases.

`configuration.profile` facts retain profile, declaring input, target and status.
The candidate inspector exposes these facts. `reviewed-absent` is an operator
assertion, not observed absence from a live container.

## Validation

Run `npm run verify`, `npm run check:helm` and `npm run test:spring-boot`.
The Boot gate is pinned to 3.5.6 / Java 17 and compares independently specified
values against both Boot Environment and configuration binding. It is a bounded
synthetic compatibility check, not full Spring or company-project certification.

Remaining work includes mounted profile composition, multi-document activation,
profile groups/includes, broader discovery and real internal-project acceptance.
