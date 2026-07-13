package com.xingchen.oa.system.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.log.OperLog;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.system.online.OnlineSession;
import com.xingchen.oa.system.online.OnlineSessionService;
import com.xingchen.oa.system.online.OnlineSessionView;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 在线用户管理 + 踢人下线。
 * <ul>
 *   <li>GET /api/system/online → 在线会话列表（含 ip/location/客户端/登录·活跃时间/是否本人当前会话）【P:system:online:list】</li>
 *   <li>POST /api/system/online/{sessionId}/kick → 踢下线（删会话，该 token 下次请求 401）【P:system:online:kick】。
 *       护栏：不能踢自己当前会话。</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/system/online")
@RequiredArgsConstructor
public class OnlineController {

    private final OnlineSessionService onlineSessionService;

    @GetMapping
    @PreAuthorize("hasAuthority('system:online:list')")
    public R<List<OnlineSessionView>> list() {
        String mySid = currentSessionId();
        List<OnlineSessionView> views = onlineSessionService.list().stream()
                .map(s -> toView(s, mySid))
                .toList();
        return R.ok(views);
    }

    @PostMapping("/{sessionId}/kick")
    @PreAuthorize("hasAuthority('system:online:kick')")
    @OperLog(module = "在线用户", action = "踢下线")
    public R<Void> kick(@PathVariable String sessionId) {
        if (sessionId.equals(currentSessionId())) {
            throw new BusinessException(400, "不能踢自己当前会话");
        }
        onlineSessionService.kick(sessionId);
        return R.ok();
    }

    private OnlineSessionView toView(OnlineSession s, String mySid) {
        return new OnlineSessionView(s.sessionId(), s.userId(), s.username(), s.name(), s.ip(),
                s.location(), s.client(), s.userAgent(), s.loginTime(), s.lastActive(),
                s.activeAssignmentId(), s.sessionId().equals(mySid));
    }

    private String currentSessionId() {
        UserContext ctx = CurrentUserHolder.get();
        return ctx == null ? null : ctx.getSessionId();
    }
}
