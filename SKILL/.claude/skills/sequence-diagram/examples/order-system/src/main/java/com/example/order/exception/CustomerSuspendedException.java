package com.example.order.exception;

public class CustomerSuspendedException extends BusinessException {

    public CustomerSuspendedException(Long customerId) {
        super("CUSTOMER_SUSPENDED", "利用停止中の顧客です: " + customerId);
    }
}
