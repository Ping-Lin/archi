package dev.archi;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.springframework.boot.Banner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.SpringBootVersion;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({ConfigurationProbe.Peer.class, ConfigurationProbe.MutablePeer.class})
public class ConfigurationProbe {
    @ConfigurationProperties(prefix = "peer")
    public record Peer(String host, String port, String baseUrl) {}

    @ConfigurationProperties(prefix = "peer")
    public static class MutablePeer {
        private String baseUrl;
        public String getBaseUrl() { return this.baseUrl; }
        public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
    }

    private static void emit(String key, String value) {
        if (value == null) throw new IllegalStateException("Missing probe property: " + key);
        System.out.println("ARCHI_PROBE:" + key + ":" + Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8)));
    }

    public static void main(String[] args) {
        var app = new SpringApplication(ConfigurationProbe.class);
        app.setWebApplicationType(WebApplicationType.NONE);
        app.setBannerMode(Banner.Mode.OFF);
        app.setLogStartupInfo(false);
        try (var context = app.run(args)) {
            emit("version", SpringBootVersion.getVersion());
            emit("environment.host", context.getEnvironment().getProperty("peer.host"));
            emit("environment.port", context.getEnvironment().getProperty("peer.port"));
            var peer = context.getBean(Peer.class);
            emit("binding.host", peer.host());
            emit("binding.port", peer.port());
            if (context.getEnvironment().getProperty("archi.probe.bean", Boolean.class, false)) {
                var mutable = context.getBean(MutablePeer.class);
                emit("binding.bean-base-url", mutable.getBaseUrl() == null ? "<null>" : mutable.getBaseUrl());
            }
            if (context.getEnvironment().getProperty("archi.probe.record", Boolean.class, false)) {
                emit("binding.base-url", peer.baseUrl() == null ? "<null>" : peer.baseUrl());
            }
        }
    }
}
