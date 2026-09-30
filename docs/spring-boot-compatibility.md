# Spring Boot compatibility gate

The executable fixture pins **Spring Boot 3.5.6, Java 17**. This is a reproducible
compatibility baseline, not a recommendation to deploy that historical patch or
a claim that every Spring Boot 3 version or application is supported.

Local result (2026-09-30): all nine cases passed on OpenJDK 17.0.20. Seven
supported cases matched all three value checks; two unsupported cases remained
incomplete in Archi. No parser changes were needed for this tested subset.
The existing 159 JavaScript tests and Helm lint/render gates also passed.

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
and Archi's `spring-properties/4` adapter. It asserts the actual Boot version.
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
The import case deliberately demonstrates a known capability gap instead of
claiming support because an operator could manually flatten the imported file.

Next: add reviewed mounted-file and ConfigData import semantics against this real
Spring oracle; broaden the version matrix when target project patch versions are known.
Do not generalize one successful version to all Boot 3 releases.

Framework reference: [Spring Boot 3.5 external configuration](https://docs.spring.io/spring-boot/3.5/reference/features/external-config.html).
