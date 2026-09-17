package example.checkout;

// Source-analysis fixture only. It does not make network requests.
public final class EndpointClient {
    private final String endpoint;
    public EndpointClient(String endpoint) { this.endpoint = endpoint; }
    public String endpoint() { return endpoint; }
}
