package com.example.order.api.dto;

public record ErrorResponse(String code, String message) {

    public static ErrorResponse of(String code, String message) {
        return new ErrorResponse(code, message);
    }
}
