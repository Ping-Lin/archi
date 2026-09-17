package demo;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Profile;
import org.springframework.beans.factory.annotation.Value;

@Configuration
public class OptionalClients {
    @Bean
    @Profile("qa")
    public RemoteClient audit(@Value("${audit.url}") String url) {
        return new RemoteClient(url);
    }
    @Bean
    public RemoteClient dynamic(@Value("${downstream.url}") String url) {
        return new RemoteClient(url.trim());
    }
}

