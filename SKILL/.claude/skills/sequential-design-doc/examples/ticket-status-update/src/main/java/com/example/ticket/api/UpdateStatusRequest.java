package com.example.ticket.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** PATCH /api/tickets/{ticketId} のリクエストボディ。 */
public record UpdateStatusRequest(
        @NotBlank String status,
        @Size(max = 500) String comment) {
}
