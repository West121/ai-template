package com.xingchen.oa.workflow.engine.script;

import com.xingchen.oa.common.script.ScriptApi;
import com.xingchen.oa.system.entity.SysDept;
import com.xingchen.oa.system.entity.SysUser;
import com.xingchen.oa.system.repository.SysDeptRepository;
import com.xingchen.oa.system.repository.SysUserAssignmentRepository;
import com.xingchen.oa.system.repository.SysUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 脚本 API 示范门面（@ScriptApi 白名单机制的样板）：组织查询。
 * 脚本内经 {@code spring.bean("scriptOrgApi")}（groovy/js）或
 * {@code var org = (ScriptOrgApi) spring.bean("scriptOrgApi")}（java）调用。
 * 只读、无副作用，适合做脚本可调 API；方法签名经 context-manifest 提示给编辑器。
 */
@ScriptApi("组织查询：用户/部门名称、部门成员（只读示范门面）")
@Component("scriptOrgApi")
@RequiredArgsConstructor
public class ScriptOrgApi {

    private final SysUserRepository userRepository;
    private final SysDeptRepository deptRepository;
    private final SysUserAssignmentRepository assignmentRepository;

    @ScriptApi("用户 id → 姓名（不存在返回 null）")
    public String userName(Long userId) {
        if (userId == null) {
            return null;
        }
        return userRepository.findById(userId).map(SysUser::getName).orElse(null);
    }

    @ScriptApi("部门 id → 部门名（不存在返回 null）")
    public String deptName(Long deptId) {
        if (deptId == null) {
            return null;
        }
        return deptRepository.findById(deptId).map(SysDept::getName).orElse(null);
    }

    @ScriptApi("部门 id → 部门负责人用户 id（未设返回 null）")
    public Long deptLeaderId(Long deptId) {
        if (deptId == null) {
            return null;
        }
        return deptRepository.findById(deptId).map(SysDept::getLeaderId).orElse(null);
    }

    @ScriptApi("部门 id → 该部门启用任职的用户 id 列表（去重）")
    public List<Long> deptUserIds(Long deptId) {
        if (deptId == null) {
            return List.of();
        }
        return assignmentRepository.findUserIdsByDeptId(deptId);
    }
}
