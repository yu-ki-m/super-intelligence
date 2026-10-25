package com.example.ticket.domain;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/** 許可するステータス遷移。表に無い遷移（CLOSED・REJECTED からの遷移を含む）は不許可。 */
public final class StatusTransitions {

    private static final Map<TicketStatus, Set<TicketStatus>> ALLOWED = Map.of(
            TicketStatus.OPEN, EnumSet.of(TicketStatus.IN_PROGRESS, TicketStatus.REJECTED),
            TicketStatus.IN_PROGRESS, EnumSet.of(TicketStatus.RESOLVED, TicketStatus.OPEN),
            TicketStatus.RESOLVED, EnumSet.of(TicketStatus.CLOSED, TicketStatus.IN_PROGRESS));

    private StatusTransitions() {
    }

    public static boolean isAllowed(TicketStatus from, TicketStatus to) {
        return ALLOWED.getOrDefault(from, Set.of()).contains(to);
    }
}
