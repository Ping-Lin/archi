package example;
import org.springframework.boot.context.properties.ConfigurationProperties;
@ConfigurationProperties(prefix = "peer")
public class Peer {
    private String baseUrl;
    public String getBaseUrl() { return this.baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
}
