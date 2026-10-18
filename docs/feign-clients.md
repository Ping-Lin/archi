# Explicit Feign registration and URL evidence

Opt in with `spring-feign/1` in a system service's source definition:

```json
{
  "adapter": "spring-feign/1",
  "files": [
    {"repository":"portal","path":"src/main/java/example/Clients.java"},
    {"repository":"portal","path":"src/main/java/example/Orders.java"}
  ],
  "registrationPolicy": "explicit-registration-and-defaults-reviewed"
}
```

This is a source excerpt, not a complete manifest. The policy asserts that the
listed registration configuration is activated and that relevant global custom
Feign components/defaults have been reviewed and do not change target selection.
It is an operator assumption, not a discovered runtime fact. Do not opt in before
reviewing those assumptions for real inputs. Synthetic fixtures are not approvals.

`Clients.java`:

```java
package example;
import org.springframework.context.annotation.Configuration;
import org.springframework.cloud.openfeign.EnableFeignClients;

@Configuration
@EnableFeignClients(clients = {Orders.class})
public class Clients {}
```

`Orders.java`:

```java
package example;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;

@FeignClient(name = "orders", url = "${downstream.url}")
public interface Orders {
    @GetMapping("/orders") String get();
}
```

## Supported boundary

Java CST extraction requires one top-level non-generic class/interface per file,
explicit imports and no inheritance. Registration classes must be empty and have
only Configuration and a clients-only EnableFeignClients annotation. Single class
literals and lists are supported; class names resolve through an explicit import,
the same package, or a fully qualified literal. No package/name guessing occurs.

FeignClient accepts only literal `name` (or `value`) and an exact `${key}` URL.
Attribute order may vary. A missing URL does not invoke service discovery. Each
interface must have exactly one registration; duplicate interface/client names,
missing registered inputs and unsupported selected files make the scope incomplete.
Limits: 64 files, 1 MiB per file, 64 clients per registration.

Interface methods are **not** interpreted or validated as Feign request contracts.
The extracted relationship means configured annotation base URL only, not actual
invocation, request URI, reachability or exhaustive dependency discovery. Request
URI overrides, custom interceptors, redirects, proxies, and application startup
are not proven. Java is parsed, not compiled against an application classpath.

Unsupported: package scanning, SpringBootApplication registration, conditional
registration, fallback/configuration/contextId/path attributes, dynamic/literal URL
expressions, placeholder defaults, inherited interfaces, name-only discovery and
Feign-specific configuration properties. Any captured `spring.cloud.openfeign.*`
or `feign.*` effective property blocks this slice conservatively. Other property
adapters still resolve the selected URL key with their existing evidence and limits.

## Evidence and tests

`client.registration` retains interface identity, registration files and reviewed
policy; evidence points to both pinned source inputs. Resolution includes that fact,
URL value history, scoped deployment evidence and explicit base-URL limitations.
Unsupported cases produce no dependency edges. Existing adapters are unchanged.

Run `node --test tests/analysis/feign.test.mjs` and `npm run verify`.
The Helm-gated test verifies pinned-source capture, dirty-file isolation, scoped
target resolution, provenance and deterministic hashes. These are synthetic
parser/resolver tests, not a running OpenFeign application compatibility suite.

Reference: [Spring Cloud OpenFeign 4.3](https://docs.spring.io/spring-cloud-openfeign/reference/4.3/spring-cloud-openfeign.html).
