package com.example.order.exception;

/** 対象データが存在しない。 */
public abstract class ResourceNotFoundException extends BusinessException {

    protected ResourceNotFoundException(String errorCode, String message) {
        super(errorCode, message);
    }
}
