# Deterministic parsing review — 2026-10-03

## Delivered

Opt-in `spring-properties/6` resolves explicitly loaded ConfigMap files from pinned
Helm render evidence. It composes with /5 imports, /4 environment references and /3
placeholders. Existing adapters remain unchanged. See
[configuration contract and reproduction](mounted-configuration.md).

The system-design workflow keeps input bindings explicit and synthetic approvals
labeled; no cluster acquisition, background refresh, deployment or PR was performed.
The Chinese adoption guide now explains multi-repo workspace layout, exact revision
selection and the distinction between repository paths and container mount paths.

## Self-review

| Question | Result |
| --- | --- |
| Does a mount alone establish loading? | No; exact ordered additional-location configuration is required |
| Are values guessed from arbitrary Helm keys? | No; actual rendered ConfigMap/volume/container fields are read |
| Can optional absence silently trigger defaults? | No; missing captured inputs make the scope incomplete |
| Does the fixture depend on the new behavior? | Yes; imported host is deliberately unresolved until mounted override |
| Is evidence available in candidate explanations? | Yes; mount facts include scoped ConfigMap identity and render provenance |
| Can a Secret or unsupported mount create a confident edge? | No; configuration remains incomplete |
| Does this prove live file access or connectivity? | No; filesystem permissions, kubelet state and traffic remain unverified |

## Verification

- `npm run generate`: no generated changes.
- `npm run verify`: 34 core/UI + 134 analysis tests; zero failures or skips with Helm.
  The skill scenario repeats the 34 core tests and is not counted again.
- `npm run check:helm`: every maintained project/context lint and render passed.
- Browser regression: review scope, gRPC, ConfigMap/import/mount evidence, export,
  mobile containment; no page errors.
- Real Spring Boot 3.5.6 / Java 17: 19 cases, 16 matched values and 3 correctly
  incomplete outcomes. Four added cases verify additional files and override order.
  Initial local build/cache failures were resolved by rebuilding temporary artifacts.

## Next direction

1. Add profile-aware ConfigData semantics with independent Boot expected results;
   include ordered active profiles and negative multi-document activation cases.
2. Extend imports to mounted files through the already captured projection table,
   without reading arbitrary paths or fetching remote locations.
3. Evaluate actual project specimens and supported Boot patch versions. Arbitrary
   Java/Kotlin client construction is still outside deterministic source extraction;
   reviewed AI evidence is not equivalent to a proven language-level interpretation.

Do not mark the entire parser or product production-ready from this bounded gate.
Real deployment end-to-end validation remains a separate manual acceptance activity.
