package com.xingchen.oa.system.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.DataScope;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.system.dto.AssignmentInfo;
import com.xingchen.oa.system.entity.SysDept;
import com.xingchen.oa.system.entity.SysRole;
import com.xingchen.oa.system.entity.SysUser;
import com.xingchen.oa.system.entity.SysUserAssignment;
import com.xingchen.oa.system.repository.SysDeptRepository;
import com.xingchen.oa.system.repository.SysPermissionRepository;
import com.xingchen.oa.system.repository.SysUserAssignmentRepository;
import com.xingchen.oa.system.repository.SysUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

/**
 * 权限装配：
 * <ul>
 *   <li>功能权限 = 用户所有有效任职上角色权限的并集；</li>
 *   <li>数据权限 = 当前激活身份（"ALL" 表示全部身份并集）按其角色 data_scope 解析出的可见范围。</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class PermissionService {

    public static final String ASSIGNMENT_ALL = "ALL";

    /** 超级管理员角色编码：代码级拥有全部权限，新增权限码无需再逐条授权 */
    public static final String SUPER_ADMIN_ROLE = "ADMIN";

    private final SysUserRepository userRepository;
    private final SysUserAssignmentRepository assignmentRepository;
    private final SysDeptRepository deptRepository;
    private final SysPermissionRepository permissionRepository;
    private final com.xingchen.oa.system.repository.SysDeptRetentionRepository deptRetentionRepository;

    /**
     * 装配用户上下文。
     *
     * @param activeAssignment "ALL"、任职 id 字符串或 null（null 时回落到主任职）
     */
    @Transactional(readOnly = true)
    public UserContext loadUserContext(String username, String activeAssignment) {
        SysUser user = userRepository.findByUsername(username)
                .orElseThrow(() -> new BusinessException(401, "用户不存在"));
        // DP2 离职：RESIGNED 用户即时失效已发 token（本方法每请求经 JwtAuthFilter 调用，抛出即被清理为未认证）
        if (SysUser.STATUS_RESIGNED.equals(user.getStatus())) {
            throw new BusinessException(401, "账号已离职，登录已失效");
        }
        List<SysUserAssignment> assignments = findEnabledAssignments(user.getId());

        // 功能权限：所有任职角色权限的并集；超级管理员直接拥有全部权限码
        Set<String> permissions = new TreeSet<>();
        boolean superAdmin = false;
        for (SysUserAssignment assignment : assignments) {
            for (SysRole role : assignment.getRoles()) {
                if (Boolean.FALSE.equals(role.getEnabled())) {
                    continue;
                }
                if (SUPER_ADMIN_ROLE.equals(role.getCode())) {
                    superAdmin = true;
                }
                role.getPermissions().forEach(p -> permissions.add(p.getCode()));
            }
        }
        if (superAdmin) {
            permissionRepository.findAll().forEach(p -> permissions.add(p.getCode()));
        }

        String active = normalizeActive(activeAssignment, assignments);
        List<SysUserAssignment> activeList = ASSIGNMENT_ALL.equals(active)
                ? assignments
                : assignments.stream().filter(a -> String.valueOf(a.getId()).equals(active)).toList();

        return UserContext.builder()
                .userId(user.getId())
                .username(user.getUsername())
                .name(user.getName())
                .permissions(List.copyOf(permissions))
                .activeAssignment(active)
                .activeDeptId(resolveActiveDeptId(activeList))
                .dataScope(resolveDataScope(user.getId(), activeList))
                .build();
    }

    @Transactional(readOnly = true)
    public List<SysUserAssignment> findEnabledAssignments(Long userId) {
        return assignmentRepository.findByUserIdAndEnabledTrueOrderByPrimaryFlagDescIdAsc(userId);
    }

    public List<AssignmentInfo> toAssignmentInfos(List<SysUserAssignment> assignments) {
        return assignments.stream()
                .map(a -> new AssignmentInfo(
                        a.getId(),
                        a.getDept() != null ? a.getDept().getId() : null,
                        a.getDept() != null ? a.getDept().getName() : null,
                        a.getPost() != null ? a.getPost().getName() : null,
                        a.getRoles().stream().map(SysRole::getName).sorted().toList(),
                        Boolean.TRUE.equals(a.getPrimaryFlag())))
                .toList();
    }

    /**
     * 校验并归一化激活身份：null → 主任职；"ALL" 原样；其余必须是本人有效任职 id。
     */
    public String normalizeActive(String activeAssignment, List<SysUserAssignment> assignments) {
        if (ASSIGNMENT_ALL.equalsIgnoreCase(activeAssignment)) {
            return ASSIGNMENT_ALL;
        }
        if (activeAssignment != null
                && assignments.stream().anyMatch(a -> String.valueOf(a.getId()).equals(activeAssignment))) {
            return activeAssignment;
        }
        // 回落到主任职（列表已按主任职优先排序）；无任职时退化为 ALL（数据范围将只剩本人）
        return assignments.isEmpty() ? ASSIGNMENT_ALL : String.valueOf(assignments.get(0).getId());
    }

    private Long resolveActiveDeptId(List<SysUserAssignment> activeList) {
        return activeList.stream()
                .sorted(Comparator.comparing((SysUserAssignment a) -> Boolean.TRUE.equals(a.getPrimaryFlag())).reversed())
                .map(a -> a.getDept() != null ? a.getDept().getId() : null)
                .filter(Objects::nonNull)
                .findFirst()
                .orElse(null);
    }

    /**
     * 按激活任职集合的角色 data_scope 解析可见范围，多角色/多任职取并集（ALL 优先）。
     */
    private DataScope resolveDataScope(Long userId, List<SysUserAssignment> activeList) {
        boolean selfOnly = false;
        Set<Long> deptIds = new HashSet<>();

        for (SysUserAssignment assignment : activeList) {
            SysDept ownDept = assignment.getDept();
            Long ownDeptId = ownDept != null ? ownDept.getId() : null;
            for (SysRole role : assignment.getRoles()) {
                if (Boolean.FALSE.equals(role.getEnabled())) {
                    continue;
                }
                switch (role.getDataScope() == null ? "" : role.getDataScope()) {
                    case SysRole.SCOPE_ALL:
                        return DataScope.all(userId);
                    case SysRole.SCOPE_DEPT_AND_CHILD:
                        // DP1b：物化路径索引子树（path LIKE '/1/4/%'），替代 findAll + 递归（每请求生效）
                        if (ownDept != null && ownDept.getPath() != null) {
                            deptIds.addAll(deptRepository.findIdsByPathPrefix(ownDept.getPath() + "%"));
                            deptIds.add(ownDeptId);
                        } else if (ownDeptId != null) {
                            deptIds.add(ownDeptId);
                        }
                        break;
                    case SysRole.SCOPE_DEPT:
                        if (ownDeptId != null) {
                            deptIds.add(ownDeptId);
                        }
                        break;
                    case SysRole.SCOPE_CUSTOM:
                        deptIds.addAll(role.getCustomDeptIds());
                        break;
                    case SysRole.SCOPE_SELF:
                    default:
                        selfOnly = true;
                        break;
                }
            }
        }
        // DP3 旧部门数据保留期：把该用户仍在保留期内的旧部门 id 并入部门维可见集（过期自动排除→收敛）。
        // 未 ALL 时生效（ALL 已提前 return）；无保留记录则不影响原行为（向后兼容）。
        deptIds.addAll(deptRetentionRepository.findActiveDeptIds(userId, java.time.LocalDateTime.now()));
        if (!deptIds.isEmpty()) {
            return DataScope.depts(deptIds, userId);
        }
        // 无部门范围（含无任职 / 仅 SELF）：仅本人数据
        return DataScope.self(userId);
    }

}
