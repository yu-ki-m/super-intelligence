package com.example.order.service;

/** 注文ユースケース。実装は {@link OrderServiceImpl}。 */
public interface OrderService {

    OrderResult registerOrder(CreateOrderCommand command);
}
