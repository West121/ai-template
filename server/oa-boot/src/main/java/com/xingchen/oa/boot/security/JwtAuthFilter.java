package com.xingchen.oa.boot.security;

import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.system.security.JwtTokenProvider;
import com.xingchen.oa.system.service.PermissionService;
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
                    UserContext context = permissionService.loadUserContext(
                            payload.username(), payload.assignment());
                    List<SimpleGrantedAuthority> authorities = context.getPermissions().stream()
                            .map(SimpleGrantedAuthority::new)
                            .toList();
                    UsernamePasswordAuthenticationToken authentication =
                            new UsernamePasswordAuthenticationToken(payload.username(), null, authorities);
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                    CurrentUserHolder.set(context);
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
