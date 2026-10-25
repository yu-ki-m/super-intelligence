package com.example.ticket.exception;

import org.springframework.http.HttpStatus;

public class TicketNotFoundException extends ApiException {

    public TicketNotFoundException(long ticketId) {
        super(HttpStatus.NOT_FOUND, "TICKET_NOT_FOUND", "チケットが存在しません: " + ticketId);
    }
}
