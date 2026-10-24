package com.example.order.infra;

import java.math.BigDecimal;

/** 与信照会の結果。availableLimit は利用可能な与信残高。 */
public record CreditStatus(Long customerId, BigDecimal availableLimit, String rating) {
}
