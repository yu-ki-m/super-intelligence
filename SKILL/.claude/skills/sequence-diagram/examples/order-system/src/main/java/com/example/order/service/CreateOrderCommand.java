package com.example.order.service;

import java.util.List;

/** 注文登録の入力。 */
public record CreateOrderCommand(Long customerId, List<OrderLineCommand> lines) {
}
