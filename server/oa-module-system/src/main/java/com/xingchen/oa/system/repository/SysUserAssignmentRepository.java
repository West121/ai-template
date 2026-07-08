package com.xingchen.oa.system.repository;

import com.xingchen.oa.system.entity.SysUserAssignment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface SysUserAssignmentRepository extends JpaRepository<SysUserAssignment, Long> {

    /**
     * 用户的全部有效任职，主任职优先。
     */
    List<SysUserAssignment> findByUserIdAndEnabledTrueOrderByPrimaryFlagDescIdAsc(Long userId);

    List<SysUserAssignment> findByUserId(Long userId);

    List<SysUserAssignment> findByUserIdInOrderByPrimaryFlagDescIdAsc(Collection<Long> userIds);

    long countByDeptId(Long deptId);

    long countByPostId(Long postId);

    boolean existsByUserIdAndDeptIdAndPostId(Long userId, Long deptId, Long postId);

    /**
     * 各部门任职数（deptId → count）。
     */
    @Query("select a.dept.id, count(a) from SysUserAssignment a group by a.dept.id")
    List<Object[]> countGroupByDept();

    /**
     * 引用某角色的任职数。
     */
    @Query("select count(a) from SysUserAssignment a join a.roles r where r.id = :roleId")
    long countByRoleId(@Param("roleId") Long roleId);
}
