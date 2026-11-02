package com.example.ticket.exception;

import org.springframework.http.HttpStatus;

public class CommentRequiredException extends ApiException {

    public CommentRequiredException() {
        super(HttpStatus.BAD_REQUEST, "COMMENT_REQUIRED", "RESOLVED にするにはコメントが必要です");
    }
}
