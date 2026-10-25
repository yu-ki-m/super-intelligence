package com.example.ticket.exception;

import org.springframework.http.HttpStatus;

public class ForbiddenException extends ApiException {

    public ForbiddenException(String code) {
        super(HttpStatus.FORBIDDEN, code, "このチケットを変更する権限がありません");
    }
}
