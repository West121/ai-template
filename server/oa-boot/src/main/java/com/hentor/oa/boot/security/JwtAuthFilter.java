package com.hentor.oa.boot.security;

import com.hentor.oa.common.security.CurrentUserHolder;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.system.online.OnlineSessionService;
import com.hentor.oa.system.security.JwtTokenProvider;
import com.hentor.oa.system.service.PermissionService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * 解析 Authorization: Bearer <token>；合法则通过 PermissionService 装配 UserContext：
 * <ul>
 *   <li>authorities = 功能权限并集（供 @PreAuthorize 判断）；</li>
 *   <li>UserContext 放入 CurrentUserHolder（ThreadLocal），供业务模块做数据权限过滤，请求结束清理。</li>
 * </ul>
 * 解析失败直接放行（保持匿名），由 Security 的授权规则返回 401。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtTokenProvider jwtTokenProvider;
    private final PermissionService permissionService;
    private final OnlineSessionService onlineSessionService;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        try {
            String header = request.getHeader("Authorization");
            if (header != null && header.startsWith(BEARER_PREFIX)) {
                String token = header.substring(BEARER_PREFIX.length());
                try {
                    JwtTokenProvider.TokenPayload payload = jwtTokenProvider.parse(token);
                    // 在线会话校验：sid 存在且已被踢（Redis 有效但会话 key 不存在）→ 不装配上下文 → 后续按未认证 401。
                    // 老 token（sid=null）/ Redis 降级 → isKicked 返回 false，正常放行（向后兼容 + 不锁死全站）。
                    if (onlineSessionService.isKicked(payload.sessionId())) {
                        SecurityContextHolder.clearContext();
                        CurrentUserHolder.clear();
                    } else {
                        UserContext context = permissionService.loadUserContext(
                                payload.username(), payload.assignment());
                        context.setSessionId(payload.sessionId());
                        List<SimpleGrantedAuthority> authorities = context.getPermissions().stream()
                                .map(SimpleGrantedAuthority::new)
                                .toList();
                        UsernamePasswordAuthenticationToken authentication =
                                new UsernamePasswordAuthenticationToken(payload.username(), null, authorities);
                        SecurityContextHolder.getContext().setAuthentication(authentication);
                        CurrentUserHolder.set(context);
                        onlineSessionService.touch(payload.sessionId()); // 节流更新 lastActive + 滑动续期
                    }
                } catch (Exception e) {
                    log.debug("JWT 解析/权限装配失败: {}", e.getMessage());
                    SecurityContextHolder.clearContext();
                    CurrentUserHolder.clear();
                }
            }
            filterChain.doFilter(request, response);
        } finally {
            CurrentUserHolder.clear();
        }
    }
}
