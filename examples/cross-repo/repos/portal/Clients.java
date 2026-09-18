package example;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Profile;
import org.springframework.beans.factory.annotation.Value;
@Configuration
public class Clients {
    @Bean
    public RemoteClient downstream(@Value("${downstream.url}") String url) { return new RemoteClient(url); }
    @Bean
    @Profile("qa")
    public RemoteClient audit(@Value("${audit.url}") String url) { return new RemoteClient(url); }
    @Bean
    public RemoteClient missing(@Value("${missing.url}") String url) { return new RemoteClient(url); }
}
