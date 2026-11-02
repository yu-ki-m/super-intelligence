package com.example.ticket.api;

import com.example.ticket.security.AuthenticatedUser;
import com.example.ticket.service.TicketService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/tickets")
public class TicketController {

    private final TicketService ticketService;

    public TicketController(TicketService ticketService) {
        this.ticketService = ticketService;
    }

    /** チケットのステータスを変更する。 */
    @PatchMapping("/{ticketId}")
    public TicketStatusResponse updateStatus(
            @PathVariable long ticketId,
            @Valid @RequestBody UpdateStatusRequest request,
            @RequestAttribute(AuthenticatedUser.ATTRIBUTE) AuthenticatedUser user) {
        return ticketService.changeStatus(user, ticketId, request.status(), request.comment());
    }
}
