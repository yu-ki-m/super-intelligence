package com.example.order.exception;

public class OutOfStockException extends BusinessException {

    public OutOfStockException(String productId, int requested, int available) {
        super("OUT_OF_STOCK", "在庫が不足しています: " + productId + " (要求 " + requested + " / 在庫 " + available + ")");
    }
}
