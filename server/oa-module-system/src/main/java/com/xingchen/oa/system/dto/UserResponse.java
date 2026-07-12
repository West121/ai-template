package com.xingchen.oa.system.dto;

import com.xingchen.oa.system.entity.SysRole;
import com.xingchen.oa.system.entity.SysUser;
import com.xingchen.oa.system.entity.SysUserAssignment;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.TreeSet;

/**
 * 用户列表/详情响应：完整档案 + 主任职部门、主任职岗位、全部任职角色名并集。
 */
public record UserResponse(
        Long id,
        String username,
        String name,
        String empNo,
        String phone,
        String email,
        String gender,
        LocalDate birthday,
        LocalDate hireDate,
        String officeLocation,
        Long leaderId,
        String leaderName,
        String avatar,
        String remark,
        Boolean enabled,
        LocalDateTime createdAt,
        String primaryDeptName,
        String primaryPostName,
        List<String> roleNames,
        /** 指定直属上级 id（多值、有序；供工作流 LEADER 节点解析）。列表接口通常为空，仅详情精确回填。 */
        List<Long> leaderIds
) {
    /**
     * @param assignments 该用户的任职列表（可为空），主任职优先排序
     * @param leaderName  直属上级姓名（由服务层按 leaderId 批量解析，避免 N+1）
     */
    public static UserResponse of(SysUser user, List<SysUserAssignment> assignments, String leaderName) {
        return of(user, assignments, leaderName, List.of());
    }

    /**
     * @param leaderIds 指定直属上级 id（有序）；详情接口传入，列表可传空。
     */
    public static UserResponse of(SysUser user, List<SysUserAssignment> assignments, String leaderName,
                                  List<Long> leaderIds) {
        SysUserAssignment primary = assignments.stream()
                .filter(a -> Boolean.TRUE.equals(a.getPrimaryFlag()))
                .findFirst()
                .orElse(assignments.isEmpty() ? null : assignments.get(0));
        TreeSet<String> roleNames = new TreeSet<>();
        for (SysUserAssignment assignment : assignments) {
            assignment.getRoles().stream().map(SysRole::getName).forEach(roleNames::add);
        }
        return new UserResponse(
                user.getId(),
                user.getUsername(),
                user.getName(),
                user.getEmpNo(),
                user.getPhone(),
                user.getEmail(),
                user.getGender(),
                user.getBirthday(),
                user.getHireDate(),
                user.getOfficeLocation(),
                user.getLeaderId(),
                leaderName,
                user.getAvatar(),
                user.getRemark(),
                user.getEnabled(),
                user.getCreatedAt(),
                primary != null && primary.getDept() != null ? primary.getDept().getName() : null,
                primary != null && primary.getPost() != null ? primary.getPost().getName() : null,
                List.copyOf(roleNames),
                leaderIds == null ? List.of() : List.copyOf(leaderIds)
        );
    }
}
