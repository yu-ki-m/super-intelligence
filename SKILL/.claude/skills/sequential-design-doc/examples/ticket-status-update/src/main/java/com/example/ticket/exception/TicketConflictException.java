package com.example.ticket.exception;

import org.springframework.http.HttpStatus;

public class TicketConflictException extends ApiException {

    public TicketConflictException(long ticketId) {
        super(HttpStatus.CONFLICT, "TICKET_CONFLICT", "他の更新と競合しました: " + ticketId);
    }
}
