package com.example.order.exception;

public class CreditLimitExceededException extends BusinessException {

    public CreditLimitExceededException(Long customerId, java.math.BigDecimal amount) {
        super("CREDIT_LIMIT_EXCEEDED", "与信限度額を超えています: " + amount);
    }
}
