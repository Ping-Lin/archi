# Unique relaxed property names for typed HTTP clients

Opt-in `spring-record-client/2` and `spring-bean-client/2` extend their `/1`
source syntax with bounded property-name selection. Keep the existing bindingPolicy
(`explicit-record-binding-reviewed` or `explicit-bean-binding-reviewed`) and change
only the source adapter version. Those review assumptions still apply; no operator
approval is inferred from fixtures. `/1` stays canonical-only.

For a canonical member key `peer.base-url`, `/2` accepts exactly one effective spelling:

| Effective key | Result |
| --- | --- |
| `peer.base-url` | Canonical |
| `peer.baseUrl` | Camel case member |
| `peer.base_url` | Underscore member |
| Two or more of these, even with equal values | Unknown |
| Other capitalization, punctuation, segment or prefix variants | Unknown |

The prefix must remain exact. Environment names still require explicit property
adapter mappings; no environment-variable discovery is added. Missing unused member
values are allowed, but competing aliases for any declared member block resolution.
Potential collisions are detected conservatively, including unsupported punctuation
and collapsed segment boundaries. Ambiguous member names also block resolution.

## Precedence boundary

The existing property adapters determine precedence for repeated **identical** keys.
Thus a camelCase key overridden by the same camelCase key in a profile file or JSON
uses the existing property chain. `/2` does not change that precedence or mutate the
property map.

The effective map does not retain enough ordered source information to compare
*different* aliases safely. A file containing `peer.baseUrl` combined with an env
mapping to `peer.base-url` therefore remains unknown. A later source-aware adapter
must retain ordered source layers and test Spring's within-source name selection
before cross-alias precedence can be enabled. Map insertion order is never used to
pick a winner. Relaxed placeholder lookup is also outside this slice.

The canonical candidate key remains stable. A `configuration.property-binding` fact
records the selected original key, all considered keys and rejection reasons. The
resolution includes their property chains alongside source and registration evidence.
Results still describe configured HTTP base URLs, not executed calls.

## Verification

Focused tests exercise both record and mutable-bean adapters, version isolation,
conflict rejection, provenance, deterministic selection and schema requirements.
Pinned repository/Helm composition exercises a camelCase bean input under `/2`.

Ten added Boot 3.5.6 scenarios check **both** real record and JavaBean accessor
values: canonical, camelCase, underscore, YAML, JSON, same-spelling JSON/profile
overrides, and three intentionally blocked alias conflicts. Expected values are
handwritten independently of Archi. HTTP source specimens are not executed.

Reference: [Spring Boot relaxed binding](https://docs.spring.io/spring-boot/3.5/reference/features/external-config.html#features.external-config.typesafe-configuration-properties.relaxed-binding).
