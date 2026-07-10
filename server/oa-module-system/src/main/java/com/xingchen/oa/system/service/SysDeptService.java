package com.xingchen.oa.system.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.system.dto.DeptRequest;
import com.xingchen.oa.system.dto.DeptTreeNode;
import com.xingchen.oa.system.entity.SysDept;
import com.xingchen.oa.system.entity.SysUser;
import com.xingchen.oa.system.repository.SysDeptRepository;
import com.xingchen.oa.system.repository.SysUserAssignmentRepository;
import com.xingchen.oa.system.repository.SysUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 部门管理：组树查询 + 增删改（维护 ancestors 祖先链，根 parentId = 0）。
 */
@Service
@RequiredArgsConstructor
public class SysDeptService {

    private static final long ROOT_PARENT_ID = 0L;

    private final SysDeptRepository deptRepository;
    private final SysUserAssignmentRepository assignmentRepository;
    private final SysUserRepository userRepository;

    @Transactional(readOnly = true)
    public List<DeptTreeNode> tree() {
        List<SysDept> depts = deptRepository.findAll();
        Map<Long, Long> userCounts = subtreeUserCounts(depts);
        // 负责人姓名：收集 leaderId 后一次 findAllById 组 map，避免 N+1
        List<Long> leaderIds = depts.stream()
                .map(SysDept::getLeaderId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<Long, String> leaderNames = leaderIds.isEmpty()
                ? Map.of()
                : userRepository.findAllById(leaderIds).stream()
                        .collect(Collectors.toMap(SysUser::getId, SysUser::getName));
        return buildTree(depts, userCounts, leaderNames, ROOT_PARENT_ID);
    }

    private List<DeptTreeNode> buildTree(List<SysDept> all, Map<Long, Long> userCounts,
                                         Map<Long, String> leaderNames, long parentId) {
        return all.stream()
                .filter(d -> Objects.equals(normalizeParent(d.getParentId()), parentId))
                .sorted(Comparator.comparing(SysDept::getSort, Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(SysDept::getId))
                .map(d -> toNode(d,
                        userCounts.getOrDefault(d.getId(), 0L),
                        d.getLeaderId() == null ? null : leaderNames.get(d.getLeaderId()),
                        buildTree(all, userCounts, leaderNames, d.getId())))
                .toList();
    }

    private DeptTreeNode toNode(SysDept d, long userCount, String leaderName, List<DeptTreeNode> children) {
        return new DeptTreeNode(
                d.getId(),
                d.getName(),
                normalizeParent(d.getParentId()),
                d.getSort(),
                d.getCode(),
                d.getLeaderId(),
                leaderName,
                d.getEnabled(),
                d.getCreatedAt(),
                userCount,
                children);
    }

    private long normalizeParent(Long parentId) {
        return parentId == null ? ROOT_PARENT_ID : parentId;
    }

    /**
     * 每个部门的 userCount = 该部门自身 + 全部子孙部门中的<b>去重用户数</b>。
     * 兼任（一个用户在子树内有多条任职）只计一次；因此父节点聚合值可能小于各叶子直属之和，
     * 这是多岗位模型的正常现象（如公司节点去重=5，而叶子相加=6）。
     */
    private Map<Long, Long> subtreeUserCounts(List<SysDept> depts) {
        // 直属：deptId -> 该部门去重用户集合
        Map<Long, Set<Long>> directUsers = new HashMap<>();
        for (Object[] row : assignmentRepository.findDistinctDeptUserPairs()) {
            directUsers.computeIfAbsent((Long) row[0], k -> new HashSet<>()).add((Long) row[1]);
        }
        Map<Long, Long> counts = new HashMap<>();
        for (SysDept d : depts) {
            Set<Long> users = new HashSet<>();
            for (Long subDeptId : descendantDeptIds(d.getId(), depts)) {
                Set<Long> direct = directUsers.get(subDeptId);
                if (direct != null) {
                    users.addAll(direct);
                }
            }
            counts.put(d.getId(), (long) users.size());
        }
        return counts;
    }

    /**
     * 部门自身 + 全部子孙部门 id（通过 ancestors 祖先链段级匹配，避免 id=1 误命中 id=11）。
     * 对外复用（如按父部门过滤用户"含子部门"），会一次性加载全部部门。
     */
    @Transactional(readOnly = true)
    public Set<Long> descendantDeptIds(Long deptId) {
        return descendantDeptIds(deptId, deptRepository.findAll());
    }

    private Set<Long> descendantDeptIds(Long deptId, List<SysDept> all) {
        Set<Long> ids = new HashSet<>();
        ids.add(deptId);
        String target = String.valueOf(deptId);
        for (SysDept d : all) {
            String ancestors = d.getAncestors();
            if (ancestors == null || ancestors.isBlank()) {
                continue;
            }
            for (String segment : ancestors.split(",")) {
                if (segment.equals(target)) {
                    ids.add(d.getId());
                    break;
                }
            }
        }
        return ids;
    }

    @Transactional
    public DeptTreeNode create(DeptRequest request) {
        if (request.name() == null || request.name().isBlank()) {
            throw new BusinessException(400, "部门名称不能为空");
        }
        long parentId = normalizeParent(request.parentId());
        SysDept dept = new SysDept();
        dept.setName(request.name().trim());
        dept.setParentId(parentId);
        dept.setSort(request.sort());
        dept.setAncestors(resolveAncestors(parentId));
        dept.setCode(resolveCode(request.code(), null));
        dept.setLeaderId(requireLeader(request.leaderId()));
        dept.setEnabled(request.enabled() == null || request.enabled());
        deptRepository.save(dept);
        return toNode(dept, 0L, leaderNameOf(dept.getLeaderId()), List.of());
    }

    /**
     * 部分更新：仅覆盖请求中非 null 的字段。leaderId = 0 清空负责人，code 空串清空编码。
     */
    @Transactional
    public void update(Long id, DeptRequest request) {
        SysDept dept = deptRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "部门不存在"));
        if (request.name() != null) {
            if (request.name().isBlank()) {
                throw new BusinessException(400, "部门名称不能为空");
            }
            dept.setName(request.name().trim());
        }
        if (request.sort() != null) {
            dept.setSort(request.sort());
        }
        if (request.code() != null) {
            dept.setCode(resolveCode(request.code(), id));
        }
        if (request.leaderId() != null) {
            dept.setLeaderId(request.leaderId() == 0L ? null : requireLeader(request.leaderId()));
        }
        if (request.enabled() != null) {
            dept.setEnabled(request.enabled());
        }
        // 若显式传了 parentId 且发生变化，则同步维护 ancestors（含子孙）
        if (request.parentId() != null && !Objects.equals(normalizeParent(dept.getParentId()), request.parentId().longValue())) {
            moveDept(dept, request.parentId());
        }
        deptRepository.save(dept);
    }

    /** 编码唯一校验：空串归一化为 null（清空），冲突 → 400 */
    private String resolveCode(String code, Long selfId) {
        if (code == null || code.isBlank()) {
            return null;
        }
        String trimmed = code.trim();
        boolean duplicated = selfId == null
                ? deptRepository.existsByCode(trimmed)
                : deptRepository.existsByCodeAndIdNot(trimmed, selfId);
        if (duplicated) {
            throw new BusinessException(400, "部门编码已存在");
        }
        return trimmed;
    }

    /** 负责人存在性校验；返回可直接落库的 leaderId */
    private Long requireLeader(Long leaderId) {
        if (leaderId == null || leaderId == 0L) {
            return null;
        }
        if (!userRepository.existsById(leaderId)) {
            throw new BusinessException(400, "负责人不存在");
        }
        return leaderId;
    }

    private String leaderNameOf(Long leaderId) {
        if (leaderId == null) {
            return null;
        }
        return userRepository.findById(leaderId).map(SysUser::getName).orElse(null);
    }

    private void moveDept(SysDept dept, long newParentId) {
        if (Objects.equals(dept.getId(), newParentId)) {
            throw new BusinessException(400, "父部门不能是自身");
        }
        String oldChain = chainOf(dept);
        String newAncestors = resolveAncestors(newParentId);
        if ((newAncestors + ",").startsWith(oldChain + ",")) {
            throw new BusinessException(400, "父部门不能是自身的下级部门");
        }
        dept.setParentId(newParentId);
        dept.setAncestors(newAncestors);
        String newChain = chainOf(dept);
        // 同步全部子孙的 ancestors 前缀
        List<SysDept> all = deptRepository.findAll();
        for (SysDept d : all) {
            if (!Objects.equals(d.getId(), dept.getId())
                    && (d.getAncestors() + ",").startsWith(oldChain + ",")) {
                d.setAncestors(newChain + d.getAncestors().substring(oldChain.length()));
                deptRepository.save(d);
            }
        }
    }

    private String chainOf(SysDept dept) {
        return dept.getAncestors() + "," + dept.getId();
    }

    private String resolveAncestors(long parentId) {
        if (parentId == ROOT_PARENT_ID) {
            return "0";
        }
        SysDept parent = deptRepository.findById(parentId)
                .orElseThrow(() -> new BusinessException(400, "父部门不存在"));
        return parent.getAncestors() + "," + parent.getId();
    }

    @Transactional
    public void delete(Long id) {
        SysDept dept = deptRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "部门不存在"));
        if (deptRepository.existsByParentId(id)) {
            throw new BusinessException(400, "存在子部门，无法删除");
        }
        if (assignmentRepository.countByDeptId(id) > 0) {
            throw new BusinessException(400, "部门下存在任职人员，无法删除");
        }
        deptRepository.delete(dept);
    }
}
