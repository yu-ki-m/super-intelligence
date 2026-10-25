package com.example.ticket.domain;

/** vulnerability_ticket の 1 行（更新に必要な列だけ）。 */
public record Ticket(long id, long projectId, TicketStatus status, int version) {
}
