package com.example.order.service;

import java.math.BigDecimal;

/** 見積結果（税抜小計・消費税・税込合計）。 */
public record PriceQuote(BigDecimal subtotal, BigDecimal tax, BigDecimal totalAmount) {
}
