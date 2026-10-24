package com.example.order.api.dto;

import com.example.order.service.OrderResult;
import java.math.BigDecimal;

public record OrderResponse(Long orderId, BigDecimal totalAmount, String status) {

    public static OrderResponse from(OrderResult r) {
        return new OrderResponse(r.orderId(), r.totalAmount(), r.status());
    }
}
