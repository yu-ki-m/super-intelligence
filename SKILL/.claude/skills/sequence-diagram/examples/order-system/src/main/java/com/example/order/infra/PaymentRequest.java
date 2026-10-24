package com.example.order.infra;

import java.math.BigDecimal;

public record PaymentRequest(Long orderId, BigDecimal amount, Long customerId) {

    public static PaymentRequest of(Long orderId, BigDecimal amount, Long customerId) {
        return new PaymentRequest(orderId, amount, customerId);
    }
}
