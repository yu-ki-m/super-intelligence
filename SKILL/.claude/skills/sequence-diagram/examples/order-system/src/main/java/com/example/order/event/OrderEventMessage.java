package com.example.order.event;

import com.example.order.domain.Order;
import java.math.BigDecimal;

/** Kafka トピック order-events に送るメッセージ。 */
public record OrderEventMessage(Long orderId, Long customerId, BigDecimal totalAmount, String status) {

    public static OrderEventMessage from(Order order) {
        return new OrderEventMessage(order.getId(), order.getCustomerId(), order.getTotalAmount(),
                order.getStatus().name());
    }
}
