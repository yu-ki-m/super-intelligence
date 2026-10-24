package com.example.order.exception;

/** 業務例外の基底クラス（RuntimeException のため @Transactional はロールバックする）。 */
public abstract class BusinessException extends RuntimeException {

    private final String errorCode;

    protected BusinessException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    public String getErrorCode() { return errorCode; }
}
