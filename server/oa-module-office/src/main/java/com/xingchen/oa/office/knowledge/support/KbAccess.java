package com.xingchen.oa.office.knowledge.support;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.office.knowledge.entity.KbSpace;
import com.xingchen.oa.office.knowledge.entity.KbSpaceMember;
import com.xingchen.oa.office.knowledge.repository.KbSpaceMemberRepository;
import com.xingchen.oa.system.entity.SysRole;
import com.xingchen.oa.system.entity.SysUserAssignment;
import com.xingchen.oa.system.repository.SysUserAssignmentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 知识库访问控制（ai-knowledge-base.md §5）。
 *
 * <p>可见性红线：PUBLIC 全员可见 / INTERNAL 登录可见 / PRIVATE 仅成员（owner 或匹配到的成员）。
 * <b>不为全局超管开后门</b>——非成员的 PRIVATE 空间对任何人（含 admin）均不可见。</p>
 *
 * <p>空间角色：owner → ADMIN；否则取匹配成员行（USER/DEPT/ROLE 三类主体命中）中的最高角色；
 * 均不命中 → null（仅在可见性允许时可只读浏览）。VIEWER 只读 / EDITOR 可编 / ADMIN 可管理。</p>
 */
@Component
@RequiredArgsConstructor
public class KbAccess {

    /** 当前登录用户在其有效任职上解析出的主体集合。 */
    public record Principals(Long userId, Set<Long> deptIds, Set<Long> roleIds) {
    }

    private final SysUserAssignmentRepository assignmentRepository;
    private final KbSpaceMemberRepository memberRepository;

    public UserContext currentUser() {
        UserContext context = CurrentUserHolder.get();
        if (context == null) {
            throw new BusinessException(401, "未登录或凭证已失效");
        }
        return context;
    }

    public String displayName(UserContext context) {
        return StringUtils.hasText(context.getName()) ? context.getName() : context.getUsername();
    }

    /**
     * 解析当前用户全部有效任职的部门 id 与角色 id（用于匹配 kb_space_member 的 DEPT/ROLE 主体）。
     */
    public Principals principals() {
        UserContext context = currentUser();
        Set<Long> deptIds = new HashSet<>();
        Set<Long> roleIds = new HashSet<>();
        List<SysUserAssignment> assignments =
                assignmentRepository.findByUserIdAndEnabledTrueOrderByPrimaryFlagDescIdAsc(context.getUserId());
        for (SysUserAssignment a : assignments) {
            if (a.getDept() != null) {
                deptIds.add(a.getDept().getId());
            }
            for (SysRole role : a.getRoles()) {
                roleIds.add(role.getId());
            }
        }
        return new Principals(context.getUserId(), deptIds, roleIds);
    }

    /**
     * 当前用户可见空间的 Specification：ACTIVE 且租户 default，且
     * visibility ∈ {PUBLIC, INTERNAL} 或 owner 本人 或 命中成员授权的空间。
     */
    public Specification<KbSpace> visibleSpaceSpec() {
        Principals p = principals();
        Set<Long> memberSpaceIds = new HashSet<>(memberRepository.findSpaceIdsByPrincipals(
                p.userId(), nonEmpty(p.deptIds()), nonEmpty(p.roleIds())));
        return (root, query, cb) -> {
            var visible = cb.or(
                    root.get("visibility").in(KbSpace.VIS_PUBLIC, KbSpace.VIS_INTERNAL),
                    cb.equal(root.get("ownerId"), p.userId()));
            if (!memberSpaceIds.isEmpty()) {
                visible = cb.or(visible, root.get("id").in(memberSpaceIds));
            }
            return cb.and(
                    cb.equal(root.get("status"), KbSpace.STATUS_ACTIVE),
                    cb.equal(root.get("tenantId"), "default"),
                    visible);
        };
    }

    /**
     * 当前用户在指定空间的有效角色：ADMIN / EDITOR / VIEWER；非成员且非 owner → null。
     */
    public String effectiveRole(KbSpace space) {
        Principals p = principals();
        if (space.getOwnerId() != null && space.getOwnerId().equals(p.userId())) {
            return KbSpaceMember.ROLE_ADMIN;
        }
        List<KbSpaceMember> matched = memberRepository.findMatchingMembers(
                space.getId(), p.userId(), nonEmpty(p.deptIds()), nonEmpty(p.roleIds()));
        String best = null;
        for (KbSpaceMember m : matched) {
            if (best == null || rank(m.getRole()) > rank(best)) {
                best = m.getRole();
            }
        }
        return best;
    }

    public boolean canView(KbSpace space) {
        if (KbSpace.VIS_PUBLIC.equals(space.getVisibility()) || KbSpace.VIS_INTERNAL.equals(space.getVisibility())) {
            return true;
        }
        // PRIVATE：仅成员/owner
        return effectiveRole(space) != null;
    }

    public boolean canEdit(KbSpace space) {
        String role = effectiveRole(space);
        return KbSpaceMember.ROLE_EDITOR.equals(role) || KbSpaceMember.ROLE_ADMIN.equals(role);
    }

    public boolean canManage(KbSpace space) {
        return KbSpaceMember.ROLE_ADMIN.equals(effectiveRole(space));
    }

    public void requireView(KbSpace space) {
        if (!canView(space)) {
            throw new BusinessException(403, "无权访问该知识空间");
        }
    }

    public void requireEdit(KbSpace space) {
        if (!canEdit(space)) {
            throw new BusinessException(403, "无该空间的文档编辑权限");
        }
    }

    public void requireManage(KbSpace space) {
        if (!canManage(space)) {
            throw new BusinessException(403, "无该空间的管理权限");
        }
    }

    private static int rank(String role) {
        return switch (role == null ? "" : role) {
            case KbSpaceMember.ROLE_ADMIN -> 3;
            case KbSpaceMember.ROLE_EDITOR -> 2;
            case KbSpaceMember.ROLE_VIEWER -> 1;
            default -> 0;
        };
    }

    /** JPQL `in :coll` 不接受空集合：空则用不可能命中的占位。 */
    private static Set<Long> nonEmpty(Set<Long> ids) {
        return ids.isEmpty() ? Set.of(-1L) : ids;
    }
}
