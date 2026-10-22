# Explicit mutable ConfigurationProperties consumption

For opt-in unique camelCase/underscore binding, see the
[`/2` adapter extension](relaxed-client-binding.md). The `/1` boundary below remains unchanged.

`spring-bean-client/1` links an explicitly registered mutable JavaBean to a direct
String getter consumed by a RestClient/WebClient factory. It shares registration
and evidence handling with the record adapter; existing record behavior is retained.

```json
{
  "adapter": "spring-bean-client/1",
  "files": [
    {"repository":"portal","path":"Peer.java"},
    {"repository":"portal","path":"Clients.java"}
  ],
  "bindingPolicy": "explicit-bean-binding-reviewed"
}
```

The policy is a reviewed assumption that configuration is activated and external
bean definitions, converters, bind handlers, post-processors and customizers do not
alter binding or client construction. Synthetic fixtures are not real operator
approvals. Choose the property adapter and its environment mappings separately.

## Supported boundary

- One public top-level non-generic properties class with explicit imports, a
  literal canonical ConfigurationProperties prefix, and no inheritance.
- 1–16 private String fields without initializers. Every field has exactly one
  public getter returning the field (with optional `this`) and one public void
  setter assigning its same-named String parameter to `this.field`.
- An implicit empty constructor; no other methods, annotations, initialization,
  nested classes, static/final fields, Lombok, validation or conversion.
- Lowercase/camel-case field names; initial lowercase followed immediately by
  uppercase is rejected because JavaBeans decapitalization differs for that shape.
- Exactly one explicit EnableConfigurationProperties registration per class.
  Configuration classes and HTTP factory forms use the same bounded rules as
  [record consumption](record-client-binding.md), with a direct getter such as
  `RestClient.builder().baseUrl(peer.getBaseUrl()).build()`.
- At most 64 selected files, 1 MiB per file. Unsupported selected code blocks the
  source scope, rather than producing a guessed dependency.

`getBaseUrl()` maps to `peer.base-url` in the provided `examples/bean-client`
specimens. Only exact canonical effective keys are accepted. Alias-only or competing
relaxed names remain unresolved; explicit environment mappings may supply canonical
keys. Missing values, invalid/non-HTTP URLs and incomplete properties produce no edge.

Binding facts retain type, member, keys, registration files and policy; source and
property evidence remains connected to resolution. Results mean configured base URL,
not actual network calls or subsequent mutation, redirects, proxies or URI overrides.

## Verification

`tests/analysis/bean-client.test.mjs` covers both clients/factory forms, type identity,
accessor behavior, rejected custom logic, aliases, evidence and pinned Helm composition.
The Boot 3.5.6 harness adds six real binding cases: properties, YAML, environment and
JSON overrides, alias-only binding (blocked), and missing URL (blocked). It executes
a getter on a mutable bean; the HTTP source specimens are not compiled or invoked.
Full framework compatibility and real-project acceptance are not claimed.

Reference: [Spring Boot JavaBean binding](https://docs.spring.io/spring-boot/3.5/reference/features/external-config.html#features.external-config.typesafe-configuration-properties.java-bean-binding).
