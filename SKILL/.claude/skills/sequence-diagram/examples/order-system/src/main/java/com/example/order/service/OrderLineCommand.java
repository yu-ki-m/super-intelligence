package com.example.order.service;

/** 注文明細の入力（商品IDと数量）。 */
public record OrderLineCommand(String productId, int quantity) {
}
