package example.checkout;

import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Profile;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

@Configuration
public class Clients {
    @Bean
    public EndpointClient clientA(@Value("${clients.a.url}") String endpoint) {
        return new EndpointClient(endpoint);
    }

    @Bean
    @Profile("dev")
    public EndpointClient clientB(@Value("${clients.b.url}") String endpoint) {
        return new EndpointClient(endpoint);
    }

    @Bean
    @ConditionalOnProperty(name = "clients.c.enabled", havingValue = "true")
    public EndpointClient clientC(@Value("${clients.c.url}") String endpoint) {
        return new EndpointClient(endpoint);
    }

    // A legacy factory is not proof of registration or execution.
    public EndpointClient legacyClient(@Value("${clients.c.url}") String endpoint) {
        return new EndpointClient(endpoint);
    }
}
