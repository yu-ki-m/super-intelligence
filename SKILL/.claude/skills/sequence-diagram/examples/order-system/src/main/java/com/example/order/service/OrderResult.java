package com.example.order.service;

import com.example.order.domain.Order;
import java.math.BigDecimal;

/** 注文登録の結果。 */
public record OrderResult(Long orderId, BigDecimal totalAmount, String status) {

    public static OrderResult from(Order order) {
        return new OrderResult(order.getId(), order.getTotalAmount(), order.getStatus().name());
    }
}
