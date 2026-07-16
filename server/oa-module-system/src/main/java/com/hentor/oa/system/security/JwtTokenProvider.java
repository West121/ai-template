package com.hentor.oa.system.security;

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
    /** 会话 id（在线用户/踢人）：同一登录会话 switch 换身份保持不变；老 token 无此 claim（向后兼容）。 */
    public static final String CLAIM_SESSION = "sid";

    private final OaJwtProperties properties;
    private final SecretKey key;

    public JwtTokenProvider(OaJwtProperties properties) {
        this.properties = properties;
        this.key = Keys.hmacShaKeyFor(properties.getSecret().getBytes(StandardCharsets.UTF_8));
    }

    /**
     * @param assignment 激活身份："ALL" 或任职 id 字符串
     * @param sessionId  在线会话 id（可空；空则不写 sid claim，退化为老式无会话绑定 token）
     */
    public String createToken(String username, String name, String assignment, String sessionId) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + properties.getExpireMinutes() * 60_000L);
        var builder = Jwts.builder()
                .subject(username)
                .claim("name", name)
                .claim(CLAIM_ASSIGNMENT, assignment)
                .issuedAt(now)
                .expiration(expiry);
        if (sessionId != null) {
            builder.claim(CLAIM_SESSION, sessionId);
        }
        return builder.signWith(key).compact();
    }

    /** token 有效期（分钟），供在线会话 TTL 对齐。 */
    public long expireMinutes() {
        return properties.getExpireMinutes();
    }

    /**
     * 解析 token，返回 (username, assignment, sessionId)。非法或过期会抛 JwtException。
     * sessionId 为空表示老式无会话绑定 token（向后兼容，不在在线列表、不可踢）。
     */
    public TokenPayload parse(String token) {
        Claims claims = Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
        return new TokenPayload(claims.getSubject(), claims.get(CLAIM_ASSIGNMENT, String.class),
                claims.get(CLAIM_SESSION, String.class));
    }

    public record TokenPayload(String username, String assignment, String sessionId) {
    }
}
