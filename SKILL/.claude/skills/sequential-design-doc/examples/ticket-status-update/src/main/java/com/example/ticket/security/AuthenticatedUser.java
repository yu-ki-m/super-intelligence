package com.example.ticket.security;

import java.util.List;

/** 認証済みユーザー。JwtAuthenticationFilter がリクエスト属性に設定する。 */
public record AuthenticatedUser(long userId, long tenantId, List<String> roles) {

    public static final String ATTRIBUTE = "authenticatedUser";

    public boolean isAdmin() {
        return roles.contains("TICKET_ADMIN");
    }
}
