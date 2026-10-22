# Spring Boot compatibility gate

The executable fixture pins **Spring Boot 3.5.6, Java 17**. This is a reproducible
compatibility baseline, not a recommendation to deploy that historical patch or
a claim that every Spring Boot 3 version or application is supported.

Initial baseline (2026-09-30): nine cases passed on OpenJDK 17.0.20, seven matched
and two intentionally incomplete. The additive /5 import adapter extends the gate
to fifteen cases: twelve value matches and three deliberately incomplete outcomes.
Import scope and bindings are described in [ConfigData imports](config-imports.md).

Mounted-file extension (2026-10-03): nineteen cases passed locally, with sixteen
value matches and three deliberately incomplete outcomes. This verifies /6 additional
file precedence on the same pinned Boot version, not Kubernetes deployment behavior.

```bash
# Requires Java 17+ and Maven; first build downloads dependencies from Maven Central.
npm run test:spring-boot
```

Optional `JAVA_BIN`, `MVN_BIN` and `MVN_SETTINGS` select local tooling/settings.
The Java fixture lives in `examples/spring-boot-compat`; Archi remains JavaScript.
The probe runs without a web server, database, network clients or Kubernetes.
Each case gets a separate temporary directory and a minimal child environment.
Ambient Spring variables and JVM option variables are not inherited by the probe.

The runner compares three independently checked outputs against handwritten
expected values: Spring `Environment`, constructor-bound `@ConfigurationProperties`,
and Archi's `spring-properties/4` or explicitly selected /5 adapter. It asserts the actual Boot version.
Spring loads real files through ConfigData; Archi receives the explicitly reviewed
file order and environment mappings. The CLI location argument is a fixture harness
control, not new Archi support for arbitrary application arguments.

| Case | Expected behavior |
| --- | --- |
| Properties file | host orders, port 7000 |
| Ordered YAML overlay | host stock, port 8000 |
| Environment override | port 9000 |
| Application JSON over environment | port 8080 |
| Transitive placeholder and default | host orders, port 8080 |
| Present empty property | empty host, no fallback |
| Explicit reviewed profile overlay | port 8100 |
| ConfigData import | Spring loads port 8200; Archi stays incomplete |
| Missing placeholder | Spring fails; Archi stays incomplete |
| Bound import (/5) | port 8200 |
| Ordered imports (/5) | last import wins, port 8200 |
| Nested import (/5) | leaf placeholder resolves port 8300 |
| Optional present import (/5) | port 8200 |
| Optional unbound import (/5) | Spring falls back; Archi stays incomplete |
| Environment over import (/5) | port 9000 |

The runner exits nonzero for unexpected results, build errors or missing tooling;
there is no skip-success path. It writes `artifacts/spring-boot-compat/report.json`
after all cases pass. The separate CI job runs this gate and uploads the report.
`npm run verify` continues to test the JavaScript/Helm pipeline independently.

## Interpretation and remaining work

Matching values demonstrate the specific configuration cases on the pinned Boot
version. They do not prove Java/Kotlin source extraction, arbitrary relaxed binding,
full profile discovery, conditional bean activation, Kubernetes env injection, gRPC
connectivity, CD equivalence or production deployment correctness.

The ConfigMap adapter has its own Helm/reference tests; this fixture supplies literal
environment values to the Java process, so it is not a kubelet integration test.
The /4 import case deliberately demonstrates its known capability gap instead of
claiming support because an operator could manually flatten the imported file.

The /5 cases verify explicit import trees without profile variants; they do not
establish arbitrary ConfigData support. Four /6 cases cover explicit additional files,
ordered properties/YAML, environment override and JSON override. Their temporary files
represent ConfigMap contents; no Kubernetes projection or permission behavior is tested.
Six /7 cases add mounted-file bound, nested, ordered, optional-present,
optional-missing and environment override scenarios, bringing the suite to 25 cases.
The full suite passed locally on 2026-10-03: 21 matched values and 4 correctly
incomplete outcomes.
Next: profile-aware semantics; broaden the version matrix when
target project patch versions are known.
Do not generalize one successful version to all Boot 3 releases.

Framework reference: [Spring Boot 3.5 external configuration](https://docs.spring.io/spring-boot/3.5/reference/features/external-config.html).

## Profile-aware adapter extension

`spring-properties/8` adds nine repository-profile cases to the gate: root/import
variant precedence, ordered imports, reversed active profiles, mixed import trees,
imports declared by profile files, and default profiles. The complete gate has
34 cases: 30 matched and four deliberately incomplete. See
[profile configuration](profile-configuration.md) for the bounded contract.

## Mounted-profile extension

`spring-properties/9` adds eight cases: mounted roots/imports, reversed active-profile
order, default variants, imports declared by a profile, mounted-over-repository
precedence, environment overrides and JSON overrides. The gate now has 42 cases
(38 matches, four intentionally incomplete).

For an offline local rerun only, `ARCHI_BOOT_PROBE_JAR=/absolute/path/probe.jar`
reuses an explicitly selected prebuilt probe and prints that Maven was skipped.
The runner still verifies Boot 3.5.6 and both Environment/binding results. CI rejects
this override and always rebuilds the probe from source. Reuse is not a build gate.
## Multi-document extension

`spring-properties/10` adds 12 document-order/activation scenarios, bringing the gate
to 54 cases (50 matches and four deliberately incomplete). See
[document activation](config-documents.md). Existing /4–/9 cases remain in the gate.

## Record client consumption extension

Six additional cases bring the gate to 60 scenarios: 54 matches and six deliberately
blocked cases. The probe binds a String `baseUrl` record component; the new source
adapter derives `peer.base-url` from the selected record/factory specimens. Canonical
properties, YAML, env and JSON overrides match. Alias-only binding and missing URL
produce no Archi edge, while the Boot accessor result is independently checked.
See [record client binding](record-client-binding.md). HTTP factories are not executed.

## Mutable bean client consumption extension

Six additional JavaBean cases bring the gate to 66 scenarios: 58 matches and eight
intentionally blocked cases. Canonical properties, YAML, environment and JSON
overrides are compared to the actual Boot getter. Alias-only and missing values
remain blocked in Archi. The probe uses a separate mutable bean with the same
prefix; its getter output is checked independently of the record accessor.
See [bean binding](bean-client-binding.md). HTTP factories are not executed.

## Unique relaxed-name extension

Ten added scenarios bring the gate to 76: 65 matched and 11 intentionally blocked.
Each new scenario checks both real record and JavaBean accessor values against
handwritten expectations, then resolves the corresponding `/2` source candidates.
Same-spelling profile/JSON overrides are supported; competing aliases remain blocked
because cross-alias source precedence is outside the effective-map contract.
See [relaxed client binding](relaxed-client-binding.md).
