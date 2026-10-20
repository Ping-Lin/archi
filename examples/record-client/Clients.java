package example;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(Peer.class)
public class Clients {
    @Bean
    public RestClient downstream(Peer peer) {
        return RestClient.builder().baseUrl(peer.baseUrl()).build();
    }
}
