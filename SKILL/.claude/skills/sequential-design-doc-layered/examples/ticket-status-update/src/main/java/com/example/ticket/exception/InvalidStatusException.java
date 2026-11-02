package com.example.ticket.exception;

import org.springframework.http.HttpStatus;

public class InvalidStatusException extends ApiException {

    public InvalidStatusException(String value) {
        super(HttpStatus.BAD_REQUEST, "INVALID_STATUS", "不正なステータスです: " + value);
    }
}
