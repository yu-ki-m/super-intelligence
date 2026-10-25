package com.example.ticket.api;

public record TicketStatusResponse(long ticketId, String status, int version, String previousStatus) {
}
