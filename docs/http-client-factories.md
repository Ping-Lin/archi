# Bounded Java HTTP client factories

System manifests can opt in to `spring-http-factory/1`:

```json
{
  "adapter": "spring-http-factory/1",
  "files": [{"repository":"portal","path":"src/main/java/Clients.java"}],
  "clientTypes": ["RestClient", "WebClient"]
}
```

This is a service `source` excerpt, not a complete manifest. Property adapters,
pinned repository capture and scoped Service/Deployment resolution are unchanged.
Legacy `spring-explicit-bean/1` does not acquire these factory semantics.

Supported Java specimen:

```java
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.client.RestClient;

@Configuration
public class Clients {
    @Bean
    public RestClient orders(@Value("${clients.orders.url}") String url) {
        return RestClient.builder().baseUrl(url).build();
    }
}
```

`RestClient.create(url)` is also supported. WebClient has the same two accepted
forms, with its explicit `org.springframework.web.reactive.function.client.WebClient`
import. Matching uses Java CST tokens, not free-text extraction. Existing simple
method Profile and ConditionalOnProperty rules apply. Only absolute HTTP/HTTPS
values that pass existing endpoint validation can resolve.

One normal Configuration class, no fields, type parameters, inheritance, nested
types or static imports, one literal Value String parameter, and exactly one
return statement are required. Custom builders, injected builders, filters,
customizers, URI factories, additional statements and computed values are unknown.
This adapter does not compile Java or validate the application's classpath.

Candidate facts, candidates and dependency exports label the endpoint
`configured-base-url`. Resolution reasons expose that request URI overrides,
later mutation, redirects, proxies and actual calls are not analyzed. A configured
base URL is not an exhaustive outbound dependency list or traffic evidence.

Run `node --test tests/analysis/http-factory.test.mjs` and `npm run verify`.
Tests are synthetic parser/resolver fixtures, not executed HTTP client requests.

References: [Spring Framework 6.2 REST clients](https://docs.spring.io/spring-framework/reference/6.2/integration/rest-clients.html).
Roadmap: [common-feature plan](common-feature-plan.md).
