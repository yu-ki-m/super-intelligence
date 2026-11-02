package com.example.ticket.repository;

import com.example.ticket.domain.Ticket;
import com.example.ticket.domain.TicketStatus;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class TicketRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public TicketRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** チケットを行ロックして取得する。 */
    public Optional<Ticket> findForUpdate(long tenantId, long ticketId) {
        List<Ticket> rows = jdbc.query("""
                SELECT id, project_id, status, version
                  FROM vulnerability_ticket
                 WHERE tenant_id = :tenantId
                   AND id = :ticketId
                   FOR UPDATE
                """,
                Map.of("tenantId", tenantId, "ticketId", ticketId),
                (rs, i) -> new Ticket(rs.getLong("id"), rs.getLong("project_id"),
                        TicketStatus.valueOf(rs.getString("status")), rs.getInt("version")));
        return rows.stream().findFirst();
    }

    /** ステータスを更新する。version が currentVersion の行だけを更新し、更新件数を返す。 */
    public int updateStatus(long ticketId, long tenantId, TicketStatus newStatus, int newVersion, long userId,
            int currentVersion) {
        return jdbc.update("""
                UPDATE vulnerability_ticket
                   SET status = :newStatus,
                       version = :newVersion,
                       updated_by = :userId,
                       updated_at = CURRENT_TIMESTAMP
                 WHERE id = :ticketId
                   AND tenant_id = :tenantId
                   AND version = :currentVersion
                """,
                Map.of("newStatus", newStatus.name(), "newVersion", newVersion, "userId", userId,
                        "ticketId", ticketId, "tenantId", tenantId, "currentVersion", currentVersion));
    }
}
