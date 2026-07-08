package com.xingchen.oa.system.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

/**
 * JWT 生成与解析（jjwt 0.12 API，HS256）。
 * claims：sub=username，name=显示名，assignment=激活身份（"ALL" 或任职 id）。
 */
@Component
public class JwtTokenProvider {

    public static final String CLAIM_ASSIGNMENT = "assignment";

    private final OaJwtProperties properties;
    private final SecretKey key;

    public JwtTokenProvider(OaJwtProperties properties) {
        this.properties = properties;
        this.key = Keys.hmacShaKeyFor(properties.getSecret().getBytes(StandardCharsets.UTF_8));
    }

    /**
     * @param assignment 激活身份："ALL" 或任职 id 字符串
     */
    public String createToken(String username, String name, String assignment) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + properties.getExpireMinutes() * 60_000L);
        return Jwts.builder()
                .subject(username)
                .claim("name", name)
                .claim(CLAIM_ASSIGNMENT, assignment)
                .issuedAt(now)
                .expiration(expiry)
                .signWith(key)
                .compact();
    }

    /**
     * 解析 token，返回 (username, assignment)。非法或过期会抛 JwtException。
     */
    public TokenPayload parse(String token) {
        Claims claims = Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
        return new TokenPayload(claims.getSubject(), claims.get(CLAIM_ASSIGNMENT, String.class));
    }

    public record TokenPayload(String username, String assignment) {
    }
}
