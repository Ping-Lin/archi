# Configuration bindings across projects

Status: implemented bounded adapters, not a complete Spring Boot configuration
engine. Existing manifests retain `spring-properties/1` unless explicitly opted in.
No cluster access, automatic discovery, LLM calls or polling are involved.

Newer opt-ins: [spring-properties/4](configmap-environment.md) adds scoped rendered
ConfigMap environment references; [ai-evidence/3](grpc-endpoints.md) adds bounded
gRPC endpoint identities. The older-version limits below remain unchanged.

## Keep project keys, bind their meaning

One project can use `gateway.peer.host` / `gateway.peer.port`, another can use
`clients.stock.address`. Neither project must rename its configuration keys.
AI proposes how source code consumes those keys; deterministic code reads their
environment-specific values. AI must not supply a guessed target service or final
environment value. Review the selected files, source interpretation and overrides.

For each deployment instance, append an explicit configuration policy:

```json
{
  "propertyFiles": [
    {"repository": "portal", "path": "application.properties"},
    {"repository": "deploy", "path": "portal-qa.yaml"}
  ],
  "propertiesComplete": true,
  "configuration": {
    "adapter": "spring-properties/2",
    "environmentBindings": [
      {"name": "PEER_PORT", "key": "gateway.peer.port"}
    ]
  }
}
```

This is an instance excerpt, not a standalone system manifest. The file list is
reviewed low-to-high precedence, not automatic classpath/profile discovery.
The supported order is listed files → explicitly mapped literal container env →
`SPRING_APPLICATION_JSON`. Unknown env, `valueFrom`, `envFrom`, command/args,
mounted configuration, missing mapped variables or mismatched rendered profiles
make the scope incomplete. `propertiesComplete` remains an operator assumption;
it cannot override those detected gaps. No ambient shell variables are read.

Environment mappings assert the application consumes that variable as that key;
the adapter does not prove Spring relaxed binding or custom application loaders.
The names and target keys must be unique. Framework bootstrap variables cannot be
mapped as ordinary application properties. Source profiles still require a matching
literal `SPRING_PROFILES_ACTIVE` on the single bound application container.

## Source-to-endpoint template

For structured endpoint bindings, select `source.adapter: "ai-evidence/2"` in the
system manifest and generate the template using the existing CLI. This selects
`archi/ai-candidates-v1alpha2`; v1 bundles keep their original `endpointKey` form.
The v2 candidate replaces `endpointKey` with one of these shapes:

```json
{"protocol":"HTTP", "endpoint":{"kind":"host-port", "hostKey":"gateway.peer.host", "portKey":"gateway.peer.port"}}
```

```json
{"protocol":"HTTPS", "endpoint":{"kind":"url-key", "key":"clients.stock.address"}}
```

These are candidate excerpts. The complete bundle still requires IDs, name,
conditions, unknowns and exact source citations covering the configuration reads
and client construction. The endpoint shape and keys participate in the candidate
hash; modifying them invalidates its declared review. `check`, `queue` and `review`
work with both versions. Do not copy an old hash or manufacture reviewer identity.

`host-port` supports literal DNS/IPv4 hosts and explicit numeric ports 1–65535 for
HTTP, HTTPS and TCP. It has no default port, path concatenation or expression DSL.
`url-key` requires a URL whose scheme agrees with the declared protocol. gRPC,
`dns:///`, custom name resolvers and split IPv6 hosts remain unsupported.
An accepted review still cannot bypass missing values or incomplete source scope.

Configuration overrides retain all value facts, their order and captured source
provenance. Endpoint construction records the keys, effective URL and supporting
evidence. The UI exposes both bound values and the constructed endpoint. This
establishes a configured relationship, not transport connectivity or live traffic.

## Properties syntax and intentional limits

The new reader supports ASCII `.properties` input, `=` / `:` / whitespace
separators, comments, continuation lines, escaped separators/whitespace and Unicode
escapes. Raw non-ASCII input is rejected to avoid guessing the application's
UTF-8 versus ISO-8859-1 loading policy. Duplicate or empty keys, malformed escapes,
and Spring multi-document separators are rejected. YAML must be a single mapping;
arrays, flattened-key collisions and multi-document configuration are unsupported.

In v2, placeholders such as `${HOST:default}`, expressions, `spring.config.*` imports,
`spring.profiles.*`, automatic active-profile file selection, secrets and custom
loaders are not implemented. They make the scope incomplete rather than silently
falling back to another value. Explicit reviewed file lists can represent a known
profile overlay, but do not establish equivalence with every Spring Boot loader.

Syntax and source-order references:
- [Java Properties](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Properties.html)
- [Spring Boot external configuration](https://docs.spring.io/spring-boot/reference/features/external-config.html)

## Runnable cross-project example

```bash
node scripts/configuration-fixture.mjs artifacts/configuration-demo
npm run analyze -- --root artifacts/configuration-demo --system accepted.json --out ../analysis
npm run dev
```

Open `/?view=analysis`. QA has a reviewed Kotlin host/port candidate and a Java
URL-key client using unrelated property names. Production retains the Kotlin
candidate as unreviewed. The port chain deliberately changes 7000 → 8000 → 9000 →
8080 across properties, YAML, env and JSON. Inspect **Connections & evidence**.
Use `system.json` instead of `accepted.json` to see the fully unreviewed AI case.
The inputs, reviews and source specimens are synthetic, not a real application run.

Remaining work: broader placeholder semantics, explicit config
data/profile loading semantics and secure Secret value resolution. Rendered
ConfigMap environment references and bounded gRPC now have separate opt-in adapters
linked above. Real project validation is separate.

## Opt-in placeholder resolution — spring-properties/3

Set the instance's `configuration.adapter` to `spring-properties/3` to expand
placeholders after the supported file/env/JSON overrides have been applied.
Existing v1/v2 adapters retain their behavior. This is an explicit closed-scope,
exact-key contract, **not** a complete implementation of Spring Environment.

```properties
gateway.peer.host=${HOST:orders}
gateway.peer.port=${port.alias:8080}
port.alias=${PORT:8080}
```

To use rendered `HOST` and `PORT` values with these exact references, declare:

```json
{
  "adapter": "spring-properties/3",
  "environmentBindings": [
    {"name": "HOST", "key": "HOST"},
    {"name": "PORT", "key": "PORT"}
  ]
}
```

The evaluator reads only the captured effective property map, not `process.env`,
system properties, another instance, or a cluster. A variable mapped to another
key is not silently remapped again for placeholders: referencing its unavailable
original name remains unknown, even with a default. Missing declared env bindings
also keep the scope incomplete.

Supported: `${key}`, `${key:default}`, multiple substitutions within a string,
transitive references and nested defaults such as `${primary:${backup:8080}}`.
Defaults apply only to absent keys; an empty value is present. Unused default
references are not evaluated. Placeholder-bearing lower-priority values remain
in the history but are not evaluated once overwritten.

Unsupported or ambiguous: dynamic placeholder names, literal braces inside
placeholder expressions, escaped placeholders,
SpEL, Kubernetes `$(VAR)` expansion, random/framework property providers and
relaxed-name aliases. Potential aliases in the captured keys cause an explicit
unknown rather than guessed precedence or a misleading default. Names are matched
exactly, including case. This contract assumes the approved source/key inventory
is complete; it does not discover all application configuration sources.

Evaluation is skipped when the source scope is incomplete. Cycles, missing keys,
unsupported syntax and bounded expansion failures produce diagnostics and prevent
dependency edges. Limits: 2048 properties, 32 dependency/nesting depth, 65536
characters per expanded value, 2 Mi characters overall, 50000 work units. These
limits are fail-closed, not silent truncation.

Derived `property.placeholder` facts preserve the referenced keys, defaults used,
supporting value-fact IDs and source evidence, including the reviewed scope policy
that justifies absence. The UI has a **Resolved configuration references** panel.
Imports, profile discovery and Secret value reads remain gaps; newer ConfigMap
and gRPC adapters are linked above and do not change /3 behavior.

Run the synthetic scenario:

```bash
node scripts/placeholder-fixture.mjs artifacts/placeholder-demo
npm run analyze -- --root artifacts/placeholder-demo --system accepted.json --out ../analysis
npm run dev
```

QA resolves the reviewed candidate to orders. Its env port 9000 is overridden by
an application-JSON reference that falls back to 8080. Production stays unreviewed.
The tests also replace that reference with a cycle and require an unknown result,
not an edge. No running application or real deployment is claimed by this fixture.
