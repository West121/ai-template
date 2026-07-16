package com.hentor.oa.office.knowledge.support;

import com.hentor.oa.office.knowledge.entity.KbSpaceMember;
import com.hentor.oa.system.entity.SysDept;
import com.hentor.oa.system.entity.SysRole;
import com.hentor.oa.system.entity.SysUser;
import com.hentor.oa.system.repository.SysDeptRepository;
import com.hentor.oa.system.repository.SysRoleRepository;
import com.hentor.oa.system.repository.SysUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 知识库展示名解析：用户 / 部门 / 角色名（成员列表、创建人/更新人展示用）。
 */
@Component
@RequiredArgsConstructor
public class KbNameResolver {

    private final SysUserRepository userRepository;
    private final SysDeptRepository deptRepository;
    private final SysRoleRepository roleRepository;

    /** 用户 id → 姓名（缺省回退用户名 / "用户#id"）。 */
    public String userName(Long userId) {
        if (userId == null) {
            return null;
        }
        return userRepository.findById(userId)
                .map(SysUser::getName)
                .orElse("用户#" + userId);
    }

    /** 成员主体（USER/DEPT/ROLE）展示名。 */
    public String principalName(String principalType, Long principalId) {
        if (principalId == null) {
            return null;
        }
        return switch (principalType == null ? "" : principalType) {
            case KbSpaceMember.PRINCIPAL_USER -> userName(principalId);
            case KbSpaceMember.PRINCIPAL_DEPT ->
                    deptRepository.findById(principalId).map(SysDept::getName).orElse("部门#" + principalId);
            case KbSpaceMember.PRINCIPAL_ROLE ->
                    roleRepository.findById(principalId).map(SysRole::getName).orElse("角色#" + principalId);
            default -> String.valueOf(principalId);
        };
    }
}
