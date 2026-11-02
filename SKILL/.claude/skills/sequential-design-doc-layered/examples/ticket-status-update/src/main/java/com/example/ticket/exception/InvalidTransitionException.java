package com.example.ticket.exception;

import com.example.ticket.domain.TicketStatus;
import org.springframework.http.HttpStatus;

public class InvalidTransitionException extends ApiException {

    public InvalidTransitionException(TicketStatus from, TicketStatus to) {
        super(HttpStatus.CONFLICT, "INVALID_TRANSITION", from + " から " + to + " へは変更できません");
    }
}
