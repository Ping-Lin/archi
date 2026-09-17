package io.demo;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Profile;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

@Configuration
public class Connections {
    @Bean
    public RemoteClient routing(@Value("${routing.endpoint}") String url) {
        return new RemoteClient(url);
    }
    @Bean
    @Profile("qa")
    public RemoteClient audit(@Value("${audit.endpoint}") String url) {
        return new RemoteClient(url);
    }
    @Bean
    @ConditionalOnProperty(name = "webhook.enabled", havingValue = "true")
    public RemoteClient webhook(@Value("${webhook.endpoint}") String url) {
        return new RemoteClient(url);
    }
    @Bean
    public RemoteClient dynamic(@Value("${routing.endpoint}") String url) {
        return new RemoteClient(url.trim());
    }
}
