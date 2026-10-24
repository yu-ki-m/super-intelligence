package com.example.order.exception;

public class ProductNotFoundException extends ResourceNotFoundException {

    public ProductNotFoundException(String productId) {
        super("PRODUCT_NOT_FOUND", "商品が存在しません: " + productId);
    }
}
