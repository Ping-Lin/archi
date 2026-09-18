package example;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import org.springframework.beans.factory.annotation.Value;
@Configuration
public class Clients {
    @Bean
    public RemoteClient downstream(@Value("${downstream.url}") String url) { return new RemoteClient(url); }
    @Bean
    public RemoteClient dynamic(@Value("${downstream.url}") String url) { return new RemoteClient(url.trim()); }
}
