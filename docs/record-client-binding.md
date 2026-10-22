# Explicit ConfigurationProperties record consumption

For opt-in unique camelCase/underscore binding, see the
[`/2` adapter extension](relaxed-client-binding.md). The `/1` boundary below remains unchanged.

`spring-record-client/1` links an explicitly registered Java properties record to
a direct accessor consumed by a RestClient/WebClient factory. It is an opt-in
source adapter; existing source and property adapters retain their semantics.

Service source excerpt:

```json
{
  "adapter": "spring-record-client/1",
  "files": [
    {"repository":"portal","path":"Peer.java"},
    {"repository":"portal","path":"Clients.java"}
  ],
  "bindingPolicy": "explicit-record-binding-reviewed"
}
```

The policy asserts that the selected configuration classes are activated and that
external bean definitions, converters, bind handlers and customizers do not change
this binding/client construction. It is a reviewed input assumption, not runtime
discovery. Real project onboarding must establish it; synthetic fixtures are not
real approvals. Select a property adapter separately for files/env/imports.

Runnable source-analysis specimens are in `examples/record-client`. Their key path:

```java
@ConfigurationProperties(prefix = "peer")
public record Peer(String baseUrl) {}

// Separate Configuration class, with explicit imports:
@EnableConfigurationProperties(Peer.class)
// ...
@Bean
public RestClient downstream(Peer peer) {
    return RestClient.builder().baseUrl(peer.baseUrl()).build();
}
```

The derived property is `peer.base-url`. The adapter requires that exact canonical
key in the effective map. It does not guess a value from `peer.baseUrl`, uppercase
environment names, or competing aliases. Known potential aliases conservatively
block resolution, including when a canonical value is also present. Explicit
environment mappings in the property adapter can supply the canonical key.

## Supported scope

- One top-level non-generic class/record per selected file; explicit imports and
  no inheritance. Registration/type lookup uses package identity or explicit imports.
- Record prefix is a literal canonical lower-case dotted/kebab name, expressed
  positionally or with `prefix`/`value`. The record has 1–16 plain String components,
  lower-case/camel-case names, and an empty body. Unused String values may be absent.
- Configuration classes have only Configuration (optionally proxyBeanMethods=false)
  and optional explicit EnableConfigurationProperties class literals. Registrations
  may share the factory class or use a separate empty Configuration class.
- Factory methods have only Bean, one record parameter, and exactly one return:
  RestClient/WebClient `create(record.accessor())` or
  `builder().baseUrl(record.accessor()).build()`.
- Exactly one declaration and registration per record; unsupported selected files
  block the whole selected source scope. Limits: 64 files, 1 MiB per file.

Mutable beans, Lombok, nested records, collections, URI/numeric conversion, custom
constructors/accessors, defaults, validation annotations, scanning, conditional
registration, injected builders and general Java/Kotlin dataflow remain unsupported.
Missing/invalid URL values and incomplete configuration produce no dependency edges.

`configuration.binding` facts retain record type, member, derived keys, registration
files and policy. Evidence includes both source inputs, effective property history
and scoped Helm target evidence. Exported candidates/edges remain labeled
`configured-base-url`; actual calls, URI overrides, redirects and proxies are not proven.

## Verification

`node --test tests/analysis/record-client.test.mjs` covers supported forms, type
identity, custom code/aliases/duplicates, provenance and pinned Helm integration.
`npm run test:spring-boot` rebuilds a Boot 3.5.6 record probe and compares six extra
cases: canonical properties, YAML, env override, JSON override, alias-only binding
(intentionally blocked in Archi), and missing URL (also blocked).

The Boot probe executes record binding; the source HTTP factory specimens are not
compiled or invoked. The result is bounded binding evidence, not general framework
compatibility or real-project acceptance.

Reference: [Spring Boot 3.5 constructor binding](https://docs.spring.io/spring-boot/3.5/reference/features/external-config.html#features.external-config.typesafe-configuration-properties.constructor-binding).
