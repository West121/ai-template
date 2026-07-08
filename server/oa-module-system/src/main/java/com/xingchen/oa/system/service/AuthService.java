package com.xingchen.oa.system.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.infra.service.LoginLogService;
import com.xingchen.oa.system.dto.LoginRequest;
import com.xingchen.oa.system.dto.LoginResponse;
import com.xingchen.oa.system.entity.SysUser;
import com.xingchen.oa.system.entity.SysUserAssignment;
import com.xingchen.oa.system.repository.SysUserRepository;
import com.xingchen.oa.system.security.JwtTokenProvider;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final SysUserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final PermissionService permissionService;
    private final LoginLogService loginLogService;

    @Transactional(readOnly = true)
    public LoginResponse login(LoginRequest request) {
        try {
            SysUser user = userRepository.findByUsername(request.username())
                    .orElseThrow(() -> new BusinessException(401, "用户名或密码错误"));
            if (!passwordEncoder.matches(request.password(), user.getPassword())) {
                throw new BusinessException(401, "用户名或密码错误");
            }
            if (Boolean.FALSE.equals(user.getEnabled())) {
                throw new BusinessException(403, "账号已被禁用");
            }
            // 默认激活主任职
            LoginResponse response = buildResponse(user, null, true);
            loginLogService.record(request.username(), true, "登录成功");
            return response;
        } catch (BusinessException e) {
            // 失败场景在异常抛出前落库（REQUIRES_NEW 独立事务，不随外层回滚丢失）
            loginLogService.record(request.username(), false, e.getMessage());
            throw e;
        }
    }

    /**
     * 身份切换：target 为本人任职 id 或 "ALL"（全部身份并集），校验归属后重签 JWT。
     */
    @Transactional(readOnly = true)
    public LoginResponse switchAssignment(String username, String target) {
        SysUser user = userRepository.findByUsername(username)
                .orElseThrow(() -> new BusinessException(401, "用户不存在"));
        if (!PermissionService.ASSIGNMENT_ALL.equalsIgnoreCase(target)) {
            List<SysUserAssignment> assignments = permissionService.findEnabledAssignments(user.getId());
            boolean owned = assignments.stream().anyMatch(a -> String.valueOf(a.getId()).equals(target));
            if (!owned) {
                throw new BusinessException(403, "无效的任职身份，或该任职不属于当前用户");
            }
        }
        return buildResponse(user, target, true);
    }

    @Transactional(readOnly = true)
    public LoginResponse me(String username, String activeAssignment) {
        SysUser user = userRepository.findByUsername(username)
                .orElseThrow(() -> new BusinessException(401, "用户不存在"));
        return buildResponse(user, activeAssignment, false);
    }

    private LoginResponse buildResponse(SysUser user, String activeAssignment, boolean withToken) {
        List<SysUserAssignment> assignments = permissionService.findEnabledAssignments(user.getId());
        String active = permissionService.normalizeActive(activeAssignment, assignments);
        UserContext context = permissionService.loadUserContext(user.getUsername(), active);
        String token = withToken
                ? jwtTokenProvider.createToken(user.getUsername(), user.getName(), active)
                : null;
        return new LoginResponse(
                token,
                new LoginResponse.UserInfo(user.getId(), user.getUsername(), user.getName()),
                permissionService.toAssignmentInfos(assignments),
                active,
                context.getPermissions());
    }
}
