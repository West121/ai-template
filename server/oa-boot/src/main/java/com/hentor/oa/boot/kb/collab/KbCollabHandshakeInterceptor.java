package com.hentor.oa.boot.kb.collab;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.CurrentUserHolder;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.office.knowledge.port.KbCollabPort;
import com.hentor.oa.system.security.JwtTokenProvider;
import com.hentor.oa.system.service.PermissionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * 知识库协同握手鉴权（ai-knowledge-base.md §4 批4b · §5 权限红线）。
 *
 * <p>端点 {@code /ws/kb/doc/{docId}} 在 Security 放行（token 不在 Authorization 头而在 query，
 * 故不走 JwtAuthFilter），鉴权在此完成：
 * <ol>
 *   <li>从 {@code ?token=} query 参数或 {@code Authorization: Bearer} 头取 JWT；缺失 → 401 拒绝握手；</li>
 *   <li>{@link JwtTokenProvider} 校验 + {@link PermissionService} 装配 {@link UserContext}；非法/过期 → 401；</li>
 *   <li>{@link KbCollabPort#assertDocEditable(Long)} 校验文档 EDITOR 权限；无权 → 403（前端据此降级单人编辑）。</li>
 * </ol>
 * 通过后把 {@code docId/userId/userName} 放入握手 attributes，供 {@link KbCollabHandler} 使用。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class KbCollabHandshakeInterceptor implements HandshakeInterceptor {

    private static final String BEARER_PREFIX = "Bearer ";
    static final String ATTR_DOC_ID = "kbDocId";
    static final String ATTR_USER_ID = "kbUserId";
    static final String ATTR_USER_NAME = "kbUserName";

    private final JwtTokenProvider jwtTokenProvider;
    private final PermissionService permissionService;
    private final KbCollabPort kbCollabPort;

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        Long docId = parseTrailingDocId(request.getURI().getPath());
        if (docId == null) {
            response.setStatusCode(HttpStatus.BAD_REQUEST);
            return false;
        }
        String token = extractToken(request);
        if (!StringUtils.hasText(token)) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        UserContext context;
        try {
            JwtTokenProvider.TokenPayload payload = jwtTokenProvider.parse(token);
            context = permissionService.loadUserContext(payload.username(), payload.assignment());
        } catch (Exception e) {
            log.debug("kb 协同握手 JWT 校验失败: {}", e.getMessage());
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        // 文档 EDITOR 权限（红线）：装配 ThreadLocal 后复用 office 端权限判定，finally 清理
        try {
            CurrentUserHolder.set(context);
            kbCollabPort.assertDocEditable(docId);
        } catch (BusinessException be) {
            response.setStatusCode(be.getCode() == 404 ? HttpStatus.NOT_FOUND
                    : be.getCode() == 401 ? HttpStatus.UNAUTHORIZED : HttpStatus.FORBIDDEN);
            return false;
        } catch (Exception e) {
            log.debug("kb 协同握手权限判定异常: {}", e.getMessage());
            response.setStatusCode(HttpStatus.FORBIDDEN);
            return false;
        } finally {
            CurrentUserHolder.clear();
        }
        attributes.put(ATTR_DOC_ID, docId);
        attributes.put(ATTR_USER_ID, context.getUserId());
        attributes.put(ATTR_USER_NAME, StringUtils.hasText(context.getName()) ? context.getName() : context.getUsername());
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // no-op
    }

    /** 从路径 /ws/kb/doc/{docId} 取末段为文档 id；非数字 → null。 */
    private Long parseTrailingDocId(String path) {
        if (path == null) {
            return null;
        }
        int slash = path.lastIndexOf('/');
        String last = slash >= 0 ? path.substring(slash + 1) : path;
        try {
            return Long.parseLong(last.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** token 优先取 query ?token=，其次 Authorization: Bearer 头。 */
    private String extractToken(ServerHttpRequest request) {
        String query = request.getURI().getRawQuery();
        if (StringUtils.hasText(query)) {
            for (String pair : query.split("&")) {
                int eq = pair.indexOf('=');
                if (eq > 0 && "token".equals(pair.substring(0, eq))) {
                    return URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
                }
            }
        }
        String header = request.getHeaders().getFirst("Authorization");
        if (header != null && header.startsWith(BEARER_PREFIX)) {
            return header.substring(BEARER_PREFIX.length());
        }
        return null;
    }
}
