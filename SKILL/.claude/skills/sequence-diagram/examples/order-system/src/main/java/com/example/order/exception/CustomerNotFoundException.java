package com.example.order.exception;

public class CustomerNotFoundException extends ResourceNotFoundException {

    public CustomerNotFoundException(Long customerId) {
        super("CUSTOMER_NOT_FOUND", "顧客が存在しません: " + customerId);
    }
}
