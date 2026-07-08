package com.xingchen.oa.system.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
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
import com.xingchen.oa.system.repository.SysDeptRepository;
import com.xingchen.oa.system.repository.SysPostRepository;
import com.xingchen.oa.system.repository.SysRoleRepository;
import com.xingchen.oa.system.repository.SysUserAssignmentRepository;
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
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * 用户管理 + 任职（兼任）管理。
 */
@Service
@RequiredArgsConstructor
public class SysUserService {

    private static final String DEFAULT_PASSWORD = "admin123";

    private final SysUserRepository userRepository;
    private final SysUserAssignmentRepository assignmentRepository;
    private final SysDeptRepository deptRepository;
    private final SysPostRepository postRepository;
    private final SysRoleRepository roleRepository;
    private final PasswordEncoder passwordEncoder;
    private final PermissionService permissionService;

    @Transactional(readOnly = true)
    public PageResult<UserResponse> page(String keyword, Long deptId, Boolean enabled, int pageNum, int pageSize) {
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
                var sub = query.subquery(Long.class);
                var a = sub.from(SysUserAssignment.class);
                sub.select(a.get("userId")).where(cb.equal(a.get("dept").get("id"), deptId));
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
                leaderNameOf(user));
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

        return UserResponse.of(user, List.of(assignment), leaderNameOf(user));
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
        return getById(id);
    }

    @Transactional
    public void updateEnabled(Long id, boolean enabled) {
        SysUser user = requireUser(id);
        user.setEnabled(enabled);
        userRepository.save(user);
    }

    /**
     * 重置密码为 admin123。
     */
    @Transactional
    public void resetPassword(Long id) {
        SysUser user = requireUser(id);
        user.setPassword(passwordEncoder.encode(DEFAULT_PASSWORD));
        userRepository.save(user);
    }

    /**
     * 删除用户，连带删除其全部任职。
     */
    @Transactional
    public void delete(Long id) {
        SysUser user = requireUser(id);
        assignmentRepository.deleteAll(assignmentRepository.findByUserId(id));
        userRepository.delete(user);
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
