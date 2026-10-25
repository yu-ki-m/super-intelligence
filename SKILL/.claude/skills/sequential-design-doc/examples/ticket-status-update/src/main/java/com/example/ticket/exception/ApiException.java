package com.example.ticket.exception;

import org.springframework.http.HttpStatus;

/** 応答のステータスとコードを持つ業務例外の基底クラス（RuntimeException）。 */
public abstract class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    protected ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() { return status; }

    public String getCode() { return code; }
}
