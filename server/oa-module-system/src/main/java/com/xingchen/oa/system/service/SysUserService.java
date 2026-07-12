package com.xingchen.oa.system.service;

import com.xingchen.oa.common.core.BatchResult;
import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.system.dto.AssignmentCreateRequest;
import com.xingchen.oa.system.dto.AssignmentInfo;
import com.xingchen.oa.system.dto.UserCreateRequest;
import com.xingchen.oa.system.dto.UserResponse;
import com.xingchen.oa.system.dto.UserUpdateRequest;
import com.xingchen.oa.system.entity.SysDept;
import com.xingchen.oa.system.entity.SysPost;
import com.xingchen.oa.system.entity.SysRole;
import com.xingchen.oa.system.entity.SysUser;
import com.xingchen.oa.system.entity.SysUserAssignment;
import com.xingchen.oa.system.entity.SysUserLeader;
import com.xingchen.oa.system.repository.SysDeptRepository;
import com.xingchen.oa.system.repository.SysPostRepository;
import com.xingchen.oa.system.repository.SysRoleRepository;
import com.xingchen.oa.system.repository.SysUserAssignmentRepository;
import com.xingchen.oa.system.repository.SysUserLeaderRepository;
import com.xingchen.oa.system.repository.SysUserRepository;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 用户管理 + 任职（兼任）管理。
 */
@Service
@RequiredArgsConstructor
public class SysUserService {

    /** 重置密码随机字符集：去除易混淆字符（0/O、1/l/I），便于管理员口头/书面转交。 */
    private static final char[] RESET_PWD_ALPHABET =
            "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#%".toCharArray();
    private static final int RESET_PWD_LENGTH = 12;
    private static final java.security.SecureRandom SECURE_RANDOM = new java.security.SecureRandom();

    private final SysUserRepository userRepository;
    private final SysUserAssignmentRepository assignmentRepository;
    private final SysUserLeaderRepository userLeaderRepository;
    private final SysDeptRepository deptRepository;
    private final SysDeptService deptService;
    private final SysPostRepository postRepository;
    private final SysRoleRepository roleRepository;
    private final PasswordEncoder passwordEncoder;
    private final PermissionService permissionService;

    @Transactional(readOnly = true)
    public PageResult<UserResponse> page(String keyword, Long deptId, Boolean enabled,
                                         boolean includeSubDept, int pageNum, int pageSize) {
        Pageable pageable = PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.ASC, "id"));
        Specification<SysUser> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (StringUtils.hasText(keyword)) {
                String like = "%" + keyword.trim() + "%";
                predicates.add(cb.or(
                        cb.like(root.get("name"), like),
                        cb.like(root.get("username"), like),
                        cb.like(root.get("empNo"), like),
                        cb.like(root.get("phone"), like)));
            }
            if (enabled != null) {
                predicates.add(cb.equal(root.get("enabled"), enabled));
            }
            if (deptId != null) {
                // includeSubDept=true（默认）：含子部门——返回该部门 + 全部后代部门的用户（去重），
                //   复用 DEPT_AND_CHILD 的 ancestors 子树逻辑（部门闭包属 DP1 优化项，本批先用现有树递归）；
                // includeSubDept=false：仅该部门直属任职用户。
                // in(子查询) 天然按用户去重。
                Set<Long> deptIds = includeSubDept ? deptService.descendantDeptIds(deptId) : Set.of(deptId);
                var sub = query.subquery(Long.class);
                var a = sub.from(SysUserAssignment.class);
                sub.select(a.get("userId")).where(a.get("dept").get("id").in(deptIds));
                predicates.add(root.get("id").in(sub));
            }
            return cb.and(predicates.toArray(new Predicate[0]));
        };
        Page<SysUser> page = userRepository.findAll(spec, pageable);

        List<Long> userIds = page.getContent().stream().map(SysUser::getId).toList();
        Map<Long, List<SysUserAssignment>> byUser = userIds.isEmpty()
                ? Map.of()
                : assignmentRepository.findByUserIdInOrderByPrimaryFlagDescIdAsc(userIds).stream()
                        .collect(Collectors.groupingBy(SysUserAssignment::getUserId));
        // 直属上级姓名：收集 leaderId 后一次 findAllById 组 map，避免 N+1
        Map<Long, String> leaderNames = resolveLeaderNames(page.getContent());
        return PageResult.from(page.map(user ->
                UserResponse.of(user, byUser.getOrDefault(user.getId(), List.of()),
                        user.getLeaderId() == null ? null : leaderNames.get(user.getLeaderId()))));
    }

    @Transactional(readOnly = true)
    public UserResponse getById(Long id) {
        SysUser user = requireUser(id);
        return UserResponse.of(user,
                assignmentRepository.findByUserIdAndEnabledTrueOrderByPrimaryFlagDescIdAsc(id),
                leaderNameOf(user),
                userLeaderRepository.findLeaderIdsByUserId(id));
    }

    /**
     * 创建用户并建立主任职（primary = true）。
     */
    @Transactional
    public UserResponse create(UserCreateRequest request) {
        if (userRepository.existsByUsername(request.username())) {
            throw new BusinessException(400, "用户名已存在");
        }
        SysDept dept = requireDept(request.deptId());
        SysPost post = requirePost(request.postId());

        SysUser user = new SysUser();
        user.setUsername(request.username());
        user.setName(request.name());
        user.setPhone(request.phone());
        user.setPassword(passwordEncoder.encode(request.password()));
        user.setEnabled(true);
        user.setDept(dept.getName());
        user.setPost(post.getName());
        user.setEmpNo(resolveEmpNo(request.empNo()));
        user.setEmail(request.email());
        user.setGender(normalizeGender(request.gender()));
        user.setBirthday(request.birthday());
        user.setHireDate(request.hireDate());
        user.setOfficeLocation(request.officeLocation());
        user.setLeaderId(requireLeader(request.leaderId(), null));
        user.setAvatar(request.avatar());
        user.setRemark(request.remark());
        userRepository.save(user);

        SysUserAssignment assignment = new SysUserAssignment();
        assignment.setUserId(user.getId());
        assignment.setDept(dept);
        assignment.setPost(post);
        assignment.setPrimaryFlag(true);
        assignment.setEnabled(true);
        assignment.setRoles(resolveRoles(request.roleIds()));
        assignmentRepository.save(assignment);

        upsertLeaders(user.getId(), request.leaderIds());

        return UserResponse.of(user, List.of(assignment), leaderNameOf(user),
                userLeaderRepository.findLeaderIdsByUserId(user.getId()));
    }

    @Transactional
    public UserResponse update(Long id, UserUpdateRequest request) {
        SysUser user = requireUser(id);
        user.setName(request.name());
        user.setPhone(request.phone());
        user.setEmail(request.email());
        user.setGender(normalizeGender(request.gender()));
        user.setBirthday(request.birthday());
        user.setHireDate(request.hireDate());
        user.setOfficeLocation(request.officeLocation());
        user.setLeaderId(requireLeader(request.leaderId(), id));
        user.setAvatar(request.avatar());
        user.setRemark(request.remark());
        userRepository.save(user);
        upsertLeaders(id, request.leaderIds());
        return getById(id);
    }

    @Transactional
    public void updateEnabled(Long id, boolean enabled) {
        SysUser user = requireUser(id);
        user.setEnabled(enabled);
        userRepository.save(user);
    }

    /**
     * 重置密码为一次性随机初始密码（B-12）。
     * 不再使用可预测的固定常量；库中仅存 BCrypt 摘要，明文仅本次调用返回给管理员转交用户。
     *
     * @return 生成的明文初始密码（仅此次可见）
     */
    @Transactional
    public String resetPassword(Long id) {
        SysUser user = requireUser(id);
        String rawPassword = randomInitialPassword();
        user.setPassword(passwordEncoder.encode(rawPassword));
        userRepository.save(user);
        return rawPassword;
    }

    /** 生成随机初始密码（{@value #RESET_PWD_LENGTH} 位，来自去混淆字符集）。 */
    private String randomInitialPassword() {
        StringBuilder sb = new StringBuilder(RESET_PWD_LENGTH);
        for (int i = 0; i < RESET_PWD_LENGTH; i++) {
            sb.append(RESET_PWD_ALPHABET[SECURE_RANDOM.nextInt(RESET_PWD_ALPHABET.length)]);
        }
        return sb.toString();
    }

    /**
     * 删除用户，连带删除其全部任职。
     */
    @Transactional
    public void delete(Long id) {
        SysUser user = requireUser(id);
        assignmentRepository.deleteAll(assignmentRepository.findByUserId(id));
        userLeaderRepository.deleteByUserId(id);   // 其直属上级配置
        userLeaderRepository.deleteByLeaderId(id);  // 以其为上级的悬挂引用
        userRepository.delete(user);
    }

    // ------------------------------------------------------------
    // 批量操作（统一协议：BatchResult{successIds, failed[{id,reason}]}；逐条独立，不整体回滚）
    // ------------------------------------------------------------

    /**
     * 批量删除用户。护栏：不删当前登录用户、不删超级管理员（各计入 failed 并给原因）。
     * 幂等：已不存在的 id 计 success。
     */
    @Transactional
    public BatchResult batchDelete(List<Long> ids) {
        BatchResult result = new BatchResult();
        List<Long> targets = distinctIds(ids);
        Long currentUserId = currentUserId();
        Set<Long> superAdminIds = superAdminIds(targets);
        for (Long id : targets) {
            if (id.equals(currentUserId)) {
                result.fail(id, "不能删除当前登录用户");
                continue;
            }
            if (superAdminIds.contains(id)) {
                result.fail(id, "超级管理员不可删除");
                continue;
            }
            Optional<SysUser> userOpt = userRepository.findById(id);
            if (userOpt.isEmpty()) {
                result.success(id); // 幂等：已删除的 id 视为成功
                continue;
            }
            assignmentRepository.deleteAll(assignmentRepository.findByUserId(id));
            userLeaderRepository.deleteByUserId(id);
            userLeaderRepository.deleteByLeaderId(id);
            userRepository.delete(userOpt.get());
            result.success(id);
        }
        return result;
    }

    /**
     * 批量启用/停用用户。护栏同批量删除：排除当前登录用户与超级管理员（避免把自己/超管停用锁死）。
     */
    @Transactional
    public BatchResult batchUpdateEnabled(List<Long> ids, boolean enabled) {
        BatchResult result = new BatchResult();
        List<Long> targets = distinctIds(ids);
        Long currentUserId = currentUserId();
        Set<Long> superAdminIds = superAdminIds(targets);
        for (Long id : targets) {
            if (id.equals(currentUserId)) {
                result.fail(id, "不能修改当前登录用户的状态");
                continue;
            }
            if (superAdminIds.contains(id)) {
                result.fail(id, "超级管理员状态不可批量修改");
                continue;
            }
            Optional<SysUser> userOpt = userRepository.findById(id);
            if (userOpt.isEmpty()) {
                result.fail(id, "用户不存在");
                continue;
            }
            SysUser user = userOpt.get();
            user.setEnabled(enabled);
            userRepository.save(user);
            result.success(id);
        }
        return result;
    }

    /**
     * 批量移动部门：把各用户的<b>主任职</b>部门改为目标部门，并同步 SysUser.dept 冗余名。
     * 目标部门不存在 → 整体 400（前置校验）；已在目标部门 → 幂等计 success。
     */
    @Transactional
    public BatchResult batchMoveDept(List<Long> ids, Long deptId) {
        SysDept target = requireDept(deptId); // 目标部门非法则整体拒绝
        BatchResult result = new BatchResult();
        for (Long id : distinctIds(ids)) {
            Optional<SysUser> userOpt = userRepository.findById(id);
            if (userOpt.isEmpty()) {
                result.fail(id, "用户不存在");
                continue;
            }
            SysUserAssignment primary = primaryAssignment(id);
            if (primary == null) {
                result.fail(id, "用户无有效任职，无法移动部门");
                continue;
            }
            if (primary.getDept() != null && Objects.equals(primary.getDept().getId(), deptId)) {
                result.success(id); // 幂等：已在目标部门
                continue;
            }
            primary.setDept(target);
            assignmentRepository.save(primary);
            SysUser user = userOpt.get();
            user.setDept(target.getName());
            userRepository.save(user);
            result.success(id);
        }
        return result;
    }

    /**
     * 批量设置角色：全量替换各用户主任职上的角色集合（roleIds 空=清空）。
     * 护栏：跳过当前登录用户本人，避免管理员批量误删自己的角色导致失去操作权限自锁；
     * 允许调整他人（含其他管理员）角色——组织管理需要重新授权他人的正常能力。
     */
    @Transactional
    public BatchResult batchSetRoles(List<Long> ids, List<Long> roleIds) {
        HashSet<SysRole> roles = resolveRoles(roleIds); // 无效角色 → 整体 400（前置校验）
        BatchResult result = new BatchResult();
        Long currentUserId = currentUserId();
        for (Long id : distinctIds(ids)) {
            if (id.equals(currentUserId)) {
                result.fail(id, "不能批量修改当前登录用户的角色");
                continue;
            }
            SysUserAssignment primary = primaryAssignment(id);
            if (primary == null) {
                result.fail(id, "用户无有效任职，无法设置角色");
                continue;
            }
            primary.setRoles(new HashSet<>(roles));
            assignmentRepository.save(primary);
            result.success(id);
        }
        return result;
    }

    /** 去重、剔除 null 的目标 id 列表。 */
    private static List<Long> distinctIds(List<Long> ids) {
        if (ids == null) {
            return List.of();
        }
        return ids.stream().filter(Objects::nonNull).distinct().toList();
    }

    /** 当前登录用户 id（无上下文时为 null，如内部调用）。 */
    private Long currentUserId() {
        UserContext ctx = CurrentUserHolder.get();
        return ctx == null ? null : ctx.getUserId();
    }

    /** 给定集合中属于超级管理员（持 ADMIN 角色）的用户 id。 */
    private Set<Long> superAdminIds(Collection<Long> ids) {
        if (ids.isEmpty()) {
            return Set.of();
        }
        return new HashSet<>(
                assignmentRepository.findUserIdsWithRoleCode(ids, PermissionService.SUPER_ADMIN_ROLE));
    }

    /** 用户的主任职（无主任职时取首条有效任职），无有效任职返回 null。 */
    private SysUserAssignment primaryAssignment(Long userId) {
        List<SysUserAssignment> assignments =
                assignmentRepository.findByUserIdAndEnabledTrueOrderByPrimaryFlagDescIdAsc(userId);
        return assignments.isEmpty() ? null : assignments.get(0);
    }

    // ------------------------------------------------------------
    // 任职（兼任）管理
    // ------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<AssignmentInfo> assignments(Long userId) {
        requireUser(userId);
        return permissionService.toAssignmentInfos(
                assignmentRepository.findByUserIdAndEnabledTrueOrderByPrimaryFlagDescIdAsc(userId));
    }

    /**
     * 添加兼任任职：primary 恒为 false；同部门同岗位重复任职 → 400。
     */
    @Transactional
    public List<AssignmentInfo> addAssignment(Long userId, AssignmentCreateRequest request) {
        requireUser(userId);
        if (assignmentRepository.existsByUserIdAndDeptIdAndPostId(userId, request.deptId(), request.postId())) {
            throw new BusinessException(400, "该部门同岗位任职已存在");
        }
        SysUserAssignment assignment = new SysUserAssignment();
        assignment.setUserId(userId);
        assignment.setDept(requireDept(request.deptId()));
        assignment.setPost(requirePost(request.postId()));
        assignment.setPrimaryFlag(false);
        assignment.setEnabled(true);
        assignment.setRoles(resolveRoles(request.roleIds()));
        assignmentRepository.save(assignment);
        return assignments(userId);
    }

    /**
     * 删除任职：主任职不可删。
     */
    @Transactional
    public void deleteAssignment(Long assignmentId) {
        SysUserAssignment assignment = assignmentRepository.findById(assignmentId)
                .orElseThrow(() -> new BusinessException(404, "任职不存在"));
        if (Boolean.TRUE.equals(assignment.getPrimaryFlag())) {
            throw new BusinessException(400, "主任职不可删除");
        }
        assignmentRepository.delete(assignment);
    }

    // ------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------

    /** 批量解析直属上级姓名：一次 findAllById 组 map */
    private Map<Long, String> resolveLeaderNames(List<SysUser> users) {
        List<Long> leaderIds = users.stream()
                .map(SysUser::getLeaderId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        if (leaderIds.isEmpty()) {
            return Map.of();
        }
        return userRepository.findAllById(leaderIds).stream()
                .collect(Collectors.toMap(SysUser::getId, SysUser::getName, (a, b) -> a));
    }

    private String leaderNameOf(SysUser user) {
        if (user.getLeaderId() == null) {
            return null;
        }
        return userRepository.findById(user.getLeaderId()).map(SysUser::getName).orElse(null);
    }

    /** 工号：前端传入则查重使用，缺省按现有最大编号 +1 自动生成（XC + 4 位） */
    private String resolveEmpNo(String empNo) {
        if (StringUtils.hasText(empNo)) {
            String trimmed = empNo.trim();
            if (userRepository.existsByEmpNo(trimmed)) {
                throw new BusinessException(400, "工号已存在");
            }
            return trimmed;
        }
        return String.format("XC%04d", userRepository.findMaxEmpNoSeq() + 1);
    }

    private String normalizeGender(String gender) {
        if (!StringUtils.hasText(gender)) {
            return "UNKNOWN";
        }
        String value = gender.trim().toUpperCase();
        if (!List.of("MALE", "FEMALE", "UNKNOWN").contains(value)) {
            throw new BusinessException(400, "性别取值仅支持 MALE / FEMALE / UNKNOWN");
        }
        return value;
    }

    /**
     * 全量替换用户的指定直属上级（sys_user_leader）：
     * <ul>
     *   <li>{@code leaderIds == null}：不改（未传该字段，保留现有配置）；</li>
     *   <li>空数组：清空；</li>
     *   <li>非空：按数组顺序写 sort_order（去重保序），先删后插全量替换。</li>
     * </ul>
     * 防御：leader_id 必须是存在用户；<b>不能把自己设为自己上级</b>（后端也拦，不只靠前端）。
     */
    private void upsertLeaders(Long userId, List<Long> leaderIds) {
        if (leaderIds == null) {
            return; // 未传 → 不动
        }
        List<Long> ordered = leaderIds.stream().filter(Objects::nonNull).distinct().toList();
        for (Long leaderId : ordered) {
            if (leaderId.equals(userId)) {
                throw new BusinessException(400, "直属上级不能选择本人");
            }
            if (!userRepository.existsById(leaderId)) {
                throw new BusinessException(400, "直属上级不存在: id=" + leaderId);
            }
        }
        userLeaderRepository.deleteByUserId(userId); // 全量替换：先清后写
        int sort = 0;
        for (Long leaderId : ordered) {
            SysUserLeader link = new SysUserLeader();
            link.setUserId(userId);
            link.setLeaderId(leaderId);
            link.setSortOrder(sort++);
            userLeaderRepository.save(link);
        }
    }

    /** 校验直属上级存在且不是本人；返回可直接落库的 leaderId */
    private Long requireLeader(Long leaderId, Long selfId) {
        if (leaderId == null) {
            return null;
        }
        if (leaderId.equals(selfId)) {
            throw new BusinessException(400, "直属上级不能选择本人");
        }
        if (!userRepository.existsById(leaderId)) {
            throw new BusinessException(400, "直属上级不存在");
        }
        return leaderId;
    }

    private SysUser requireUser(Long id) {
        return userRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "用户不存在"));
    }

    private SysDept requireDept(Long id) {
        return deptRepository.findById(id)
                .orElseThrow(() -> new BusinessException(400, "部门不存在"));
    }

    private SysPost requirePost(Long id) {
        return postRepository.findById(id)
                .orElseThrow(() -> new BusinessException(400, "岗位不存在"));
    }

    private HashSet<SysRole> resolveRoles(List<Long> roleIds) {
        if (roleIds == null || roleIds.isEmpty()) {
            return new HashSet<>();
        }
        List<SysRole> roles = roleRepository.findAllById(roleIds);
        if (roles.size() != new HashSet<>(roleIds).size()) {
            throw new BusinessException(400, "存在无效的角色");
        }
        return new HashSet<>(roles);
    }
}
