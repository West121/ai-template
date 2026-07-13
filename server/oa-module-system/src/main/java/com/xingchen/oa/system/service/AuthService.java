package com.xingchen.oa.system.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.infra.service.LoginLogService;
import com.xingchen.oa.system.datadim.DataDimensionService;
import com.xingchen.oa.system.dto.ChangePasswordRequest;
import com.xingchen.oa.system.dto.LoginRequest;
import com.xingchen.oa.system.dto.LoginResponse;
import com.xingchen.oa.system.dto.ProfileUpdateRequest;
import com.xingchen.oa.system.entity.SysUser;
import com.xingchen.oa.system.entity.SysUserAssignment;
import com.xingchen.oa.system.repository.SysUserRepository;
import com.xingchen.oa.system.security.JwtTokenProvider;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final SysUserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final PermissionService permissionService;
    private final LoginLogService loginLogService;
    private final DataDimensionService dataDimensionService;

    @Transactional(readOnly = true)
    public LoginResponse login(LoginRequest request) {
        try {
            SysUser user = userRepository.findByUsername(request.username())
                    .orElseThrow(() -> new BusinessException(401, "用户名或密码错误"));
            if (!passwordEncoder.matches(request.password(), user.getPassword())) {
                throw new BusinessException(401, "用户名或密码错误");
            }
            if (SysUser.STATUS_RESIGNED.equals(user.getStatus())) {
                throw new BusinessException(403, "账号已离职，无法登录");
            }
            if (Boolean.FALSE.equals(user.getEnabled())) {
                throw new BusinessException(403, "账号已被禁用");
            }
            // 默认激活主任职
            LoginResponse response = buildResponse(user, null, true);
            dataDimensionService.prewarm(user.getId()); // DP1b：登录即预热各维可见范围缓存
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

    /**
     * 个人中心·修改密码（改自己，仅需登录，按 CurrentUserHolder 定位本人）。
     * 原密码错 → 400；新密码 &lt;6 位或与原密码相同 → 400。token 不失效（保持简单）。
     */
    @Transactional
    public void changePassword(String username, ChangePasswordRequest req) {
        SysUser user = userRepository.findByUsername(username)
                .orElseThrow(() -> new BusinessException(401, "用户不存在"));
        if (!passwordEncoder.matches(req.oldPassword(), user.getPassword())) {
            throw new BusinessException(400, "原密码错误");
        }
        String pwd = req.newPassword();
        if (pwd == null || pwd.length() < 6) {
            throw new BusinessException(400, "新密码长度至少 6 位");
        }
        if (passwordEncoder.matches(pwd, user.getPassword())) {
            throw new BusinessException(400, "新密码不能与原密码相同");
        }
        user.setPassword(passwordEncoder.encode(pwd));
        userRepository.save(user);
    }

    /**
     * 个人中心·更新本人安全档案（仅本人）：nickname→name（非空才改）、phone/email/avatar（null 不改，空串可清）。
     * <b>绝不</b>改 dept/post/role/status/enabled 等身份/权限字段。返回同 /me 形状（含更新后 user，不重签 token）。
     */
    @Transactional
    public LoginResponse updateProfile(String username, ProfileUpdateRequest req, String activeAssignment) {
        SysUser user = userRepository.findByUsername(username)
                .orElseThrow(() -> new BusinessException(401, "用户不存在"));
        if (StringUtils.hasText(req.nickname())) {
            user.setName(req.nickname().trim()); // name NOT NULL：仅非空覆盖
        }
        if (req.phone() != null) {
            user.setPhone(req.phone().trim());
        }
        if (req.email() != null) {
            user.setEmail(req.email().trim());
        }
        if (req.avatar() != null) {
            user.setAvatar(req.avatar());
        }
        userRepository.save(user);
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
                new LoginResponse.UserInfo(user.getId(), user.getUsername(), user.getName(),
                        user.getEmail(), user.getPhone(), user.getAvatar()),
                permissionService.toAssignmentInfos(assignments),
                active,
                context.getPermissions());
    }
}
