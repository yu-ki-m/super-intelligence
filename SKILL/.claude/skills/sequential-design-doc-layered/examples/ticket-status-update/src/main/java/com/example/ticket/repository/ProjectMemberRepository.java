package com.example.ticket.repository;

import java.util.Map;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ProjectMemberRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public ProjectMemberRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** ユーザーがプロジェクトの現メンバーか。 */
    public boolean isMember(long projectId, long userId) {
        Integer count = jdbc.queryForObject("""
                SELECT COUNT(*)
                  FROM project_member
                 WHERE project_id = :projectId
                   AND user_id = :userId
                   AND removed_at IS NULL
                """,
                Map.of("projectId", projectId, "userId", userId), Integer.class);
        return count != null && count > 0;
    }
}
