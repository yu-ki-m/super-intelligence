package com.example.order.infra;

import java.math.BigDecimal;

/** 決済承認の結果。transactionId は決済代行サービスの取引ID。 */
public record PaymentResult(String transactionId, BigDecimal amount) {
}
