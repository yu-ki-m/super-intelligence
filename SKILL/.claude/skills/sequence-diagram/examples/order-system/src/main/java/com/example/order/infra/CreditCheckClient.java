package com.example.order.infra;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** 外部の与信照会サービス（Credit Bureau API）のクライアント。 */
@Component
public class CreditCheckClient {

    private final RestClient creditRestClient;

    public CreditCheckClient(RestClient creditRestClient) {
        this.creditRestClient = creditRestClient;
    }

    public CreditStatus check(Long customerId) {
        return creditRestClient.get()
                .uri("/v2/customers/{id}/credit", customerId)
                .retrieve()
                .body(CreditStatus.class);
    }
}
