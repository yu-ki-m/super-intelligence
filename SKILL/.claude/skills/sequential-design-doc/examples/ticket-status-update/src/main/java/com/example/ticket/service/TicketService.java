package com.example.ticket.service;

import com.example.ticket.api.TicketStatusResponse;
import com.example.ticket.domain.StatusTransitions;
import com.example.ticket.domain.Ticket;
import com.example.ticket.domain.TicketStatus;
import com.example.ticket.exception.CommentRequiredException;
import com.example.ticket.exception.ForbiddenException;
import com.example.ticket.exception.InvalidTransitionException;
import com.example.ticket.exception.TicketConflictException;
import com.example.ticket.exception.TicketNotFoundException;
import com.example.ticket.repository.ProjectMemberRepository;
import com.example.ticket.repository.TicketHistoryRepository;
import com.example.ticket.repository.TicketRepository;
import com.example.ticket.security.AuthenticatedUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TicketService {

    private final TicketRepository ticketRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final TicketHistoryRepository historyRepository;

    public TicketService(TicketRepository ticketRepository, ProjectMemberRepository projectMemberRepository,
            TicketHistoryRepository historyRepository) {
        this.ticketRepository = ticketRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.historyRepository = historyRepository;
    }

    @Transactional
    public TicketStatusResponse changeStatus(AuthenticatedUser user, long ticketId, String requestedStatus,
            String comment) {
        TicketStatus newStatus = TicketStatus.parse(requestedStatus);

        Ticket ticket = ticketRepository.findForUpdate(user.tenantId(), ticketId)
                .orElseThrow(() -> new TicketNotFoundException(ticketId));

        if (!user.isAdmin() && !projectMemberRepository.isMember(ticket.projectId(), user.userId())) {
            throw new ForbiddenException("NOT_PROJECT_MEMBER");
        }

        TicketStatus previousStatus = ticket.status();
        if (!StatusTransitions.isAllowed(previousStatus, newStatus)) {
            throw new InvalidTransitionException(previousStatus, newStatus);
        }
        if (newStatus == TicketStatus.RESOLVED && (comment == null || comment.isBlank())) {
            throw new CommentRequiredException();
        }

        int newVersion = ticket.version() + 1;
        int updated = ticketRepository.updateStatus(ticketId, user.tenantId(), newStatus, newVersion,
                user.userId(), ticket.version());
        if (updated != 1) {
            throw new TicketConflictException(ticketId);
        }

        historyRepository.insert(ticketId, previousStatus, newStatus, user.userId(), comment);

        return new TicketStatusResponse(ticketId, newStatus.name(), newVersion, previousStatus.name());
    }
}
