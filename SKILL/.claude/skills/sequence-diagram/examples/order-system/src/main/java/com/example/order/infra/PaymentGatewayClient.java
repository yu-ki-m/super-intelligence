package com.example.order.infra;

import com.example.order.exception.PaymentDeclinedException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** 決済代行サービス（Payment Gateway API）のクライアント。 */
@Component
public class PaymentGatewayClient {

    private final RestClient paymentRestClient;

    public PaymentGatewayClient(RestClient paymentRestClient) {
        this.paymentRestClient = paymentRestClient;
    }

    public PaymentResult authorize(PaymentRequest request) {
        return paymentRestClient.post()
                .uri("/v1/authorizations")
                .body(request)
                .retrieve()
                .onStatus(s -> s.value() == HttpStatus.PAYMENT_REQUIRED.value(), (req, res) -> {
                    throw new PaymentDeclinedException(request.orderId(), res.getHeaders().getFirst("X-Decline-Reason"));
                })
                .body(PaymentResult.class);
    }
}
