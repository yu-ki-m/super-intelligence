package com.example.ticket.security;

import com.example.ticket.api.ErrorResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** /api/ 配下のリクエストで JWT（Bearer トークン）を検証し、認証済みユーザーをリクエスト属性に設定する。 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String PREFIX = "Bearer ";

    private final JwtVerifier jwtVerifier;
    private final ObjectMapper objectMapper;

    public JwtAuthenticationFilter(JwtVerifier jwtVerifier, ObjectMapper objectMapper) {
        this.jwtVerifier = jwtVerifier;
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith(PREFIX)) {
            writeError(response, "AUTH_REQUIRED");
            return;
        }
        String token = header.substring(PREFIX.length());
        AuthenticatedUser user;
        try {
            user = jwtVerifier.verify(token);
        } catch (JwtVerificationException e) {
            writeError(response, e.getReason());
            return;
        }
        request.setAttribute(AuthenticatedUser.ATTRIBUTE, user);
        chain.doFilter(request, response);
    }

    private void writeError(HttpServletResponse response, String code) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json");
        objectMapper.writeValue(response.getOutputStream(), new ErrorResponse(code, "認証に失敗しました"));
    }
}
