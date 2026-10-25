package com.example.ticket.security;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.auth0.jwt.exceptions.TokenExpiredException;
import com.auth0.jwt.interfaces.DecodedJWT;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** JWT の署名・発行者・有効期限を検証し、クレームから認証済みユーザーを作る（auth0 java-jwt）。 */
@Component
public class JwtVerifier {

    private static final String ISSUER = "ticket-auth";

    private final Algorithm algorithm;

    public JwtVerifier(@Value("${security.jwt.secret}") String secret) {
        this.algorithm = Algorithm.HMAC256(secret);
    }

    public AuthenticatedUser verify(String token) {
        DecodedJWT jwt;
        try {
            jwt = JWT.require(algorithm).withIssuer(ISSUER).build().verify(token);
        } catch (TokenExpiredException e) {
            throw new JwtVerificationException("TOKEN_EXPIRED");
        } catch (JWTVerificationException e) {
            throw new JwtVerificationException("TOKEN_INVALID");
        }
        long userId = Long.parseLong(jwt.getSubject());
        long tenantId = jwt.getClaim("tid").asLong();
        List<String> roles = jwt.getClaim("roles").asList(String.class);
        return new AuthenticatedUser(userId, tenantId, roles == null ? List.of() : roles);
    }
}
