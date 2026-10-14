# Multi-document activation (opt-in /10)

`spring-properties/10` adds ordered YAML/properties documents and bounded
`spring.config.activate.on-profile` evaluation. Select /10 using either the /8
repository-only configuration fields or the complete /9 mounted configuration
fields. Previous adapters do not acquire these semantics automatically.

```properties
peer.port=7000
#---
spring.config.activate.on-profile=qa & !prod
peer.port=8100
!---
spring.config.activate.on-profile=prod
peer.port=9000
```

With reviewed active profiles `['qa']`, the effective port is `8100`. YAML uses
standard `---` document separators. Properties support exact column-zero `#---`
and `!---`; ambiguous adjacent same-prefix comments and separators following a
continuation are conservatively rejected. Empty YAML documents contribute no values.

## Supported boundary

- Active documents apply in physical order; later documents override earlier ones.
- Each active document's explicit imports are traversed after that document.
- Profile-specific files retain /8–/9 ordering and explicit bindings.
- Profile expressions support names, `!`, `&`, `|` and parentheses. Mixed `&`/`|`
  at the same level require parentheses. Empty active profiles match `default`.
- Inactive document values, placeholders and imports are excluded. Do not declare
  bindings for imports used only in inactive documents: unused bindings remain
  incomplete rather than silently accepting stale input mappings.
- Mounted documents use the same parser after ConfigMap projection and retain
  workload/render evidence. No container or live cluster is queried.

Unsupported: activation expression lists, dynamic expressions, cloud-platform
activation, profile groups/includes/default/active directives in files, general
ConfigData discovery and repeated/shared imports. Unsupported bootstrap or activation
directives are rejected even in an otherwise inactive document. Malformed documents
never become silently ignored input. Incomplete configuration does not produce edges.

Limits: 1 MiB per file, 32 documents per file, 256 characters and 64 tokens per
expression, nesting depth 16. Existing profile/file/import bounds still apply.

## Evidence and verification

`configuration.document` facts record the physical input, zero-based document index,
expression and activation result. Property locators append `#document=N`; their
supporting evidence still references the pinned physical file or captured render.
The inspector displays both active and inactive documents. Activation is conditional
on reviewed profiles, not evidence of which configuration a live process loaded.

```bash
node scripts/mounted-config-fixture.mjs artifacts/documents-demo --documents
npm run analyze -- --root artifacts/documents-demo --system accepted.json --out ../analysis
npm run verify
npm run test:spring-boot
```

The Boot 3.5.6 gate has 54 scenarios: 50 matching value cases and four deliberately
incomplete cases. The new cases include YAML/properties order, active/inactive
imports, imported activation, profile variants, default profiles, mounted documents
and environment precedence. This is bounded synthetic parity, not full Spring
compatibility or real-project acceptance.

Reference: [Spring Boot multi-document configuration](https://docs.spring.io/spring-boot/3.5/reference/features/external-config.html#features.external-config.files.multi-document).
