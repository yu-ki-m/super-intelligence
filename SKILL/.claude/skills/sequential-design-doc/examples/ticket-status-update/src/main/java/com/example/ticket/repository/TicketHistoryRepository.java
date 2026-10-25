package com.example.ticket.repository;

import com.example.ticket.domain.TicketStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class TicketHistoryRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public TicketHistoryRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(long ticketId, TicketStatus from, TicketStatus to, long userId, String comment) {
        jdbc.update("""
                INSERT INTO ticket_status_history
                    (ticket_id, from_status, to_status, changed_by, comment, changed_at)
                VALUES
                    (:ticketId, :fromStatus, :toStatus, :changedBy, :comment, CURRENT_TIMESTAMP)
                """,
                new MapSqlParameterSource()
                        .addValue("ticketId", ticketId)
                        .addValue("fromStatus", from.name())
                        .addValue("toStatus", to.name())
                        .addValue("changedBy", userId)
                        .addValue("comment", comment));
    }
}
