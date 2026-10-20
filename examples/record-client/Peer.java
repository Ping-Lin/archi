package example;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "peer")
public record Peer(String baseUrl) {}
