package com.example.order.infra;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** 監査ログ（audit_logs）。呼び出し元とは独立したトランザクションで必ず記録する。 */
@Component
public class AuditLogger {

    private final JdbcTemplate jdbcTemplate;

    public AuditLogger(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String action, Long orderId) {
        jdbcTemplate.update(
                "INSERT INTO audit_logs (action, order_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                action, orderId);
    }
}
