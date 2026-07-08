package com.xingchen.oa.system.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.system.dto.LoginRequest;
import com.xingchen.oa.system.dto.LoginResponse;
import com.xingchen.oa.system.dto.SwitchAssignmentRequest;
import com.xingchen.oa.system.service.AuthService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public R<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        return R.ok(authService.login(request));
    }

    /**
     * 身份切换：assignmentId 为本人任职 id 或 "ALL"，返回重签后的 token 与最新上下文。
     */
    @PostMapping("/switch")
    public R<LoginResponse> switchAssignment(@Valid @RequestBody SwitchAssignmentRequest request) {
        UserContext context = requireContext();
        return R.ok(authService.switchAssignment(context.getUsername(), request.assignmentId()));
    }

    @GetMapping("/me")
    public R<LoginResponse> me() {
        UserContext context = requireContext();
        return R.ok(authService.me(context.getUsername(), context.getActiveAssignment()));
    }

    private UserContext requireContext() {
        UserContext context = CurrentUserHolder.get();
        if (context == null) {
            throw new BusinessException(401, "未登录或凭证已失效");
        }
        return context;
    }
}
