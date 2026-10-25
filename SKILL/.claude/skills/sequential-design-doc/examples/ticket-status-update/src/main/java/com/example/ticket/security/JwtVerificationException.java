package com.example.ticket.security;

/** JWT の検証に失敗した。reason は応答の code に使う。 */
public class JwtVerificationException extends RuntimeException {

    private final String reason;

    public JwtVerificationException(String reason) {
        super(reason);
        this.reason = reason;
    }

    public String getReason() { return reason; }
}
