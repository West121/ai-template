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
     * 全量去重的「部门-用户」对（deptId, userId）。
     * 用于按子树聚合部门人数时去重（一个用户在同一部门的多条任职只出一次）。
     */
    @Query("select distinct a.dept.id, a.userId from SysUserAssignment a")
    List<Object[]> findDistinctDeptUserPairs();

    /**
     * 引用某角色的任职数。
     */
    @Query("select count(a) from SysUserAssignment a join a.roles r where r.id = :roleId")
    long countByRoleId(@Param("roleId") Long roleId);

    /**
     * 持有某角色的启用任职对应用户 id（去重）。
     * B-09：替代 AssigneeResolver 中 findAll().stream().filter 全表扫描。
     */
    @Query("select distinct a.userId from SysUserAssignment a join a.roles r "
            + "where r.id = :roleId and a.enabled = true")
    List<Long> findUserIdsByRoleId(@Param("roleId") Long roleId);

    /**
     * 任职于某岗位的启用任职对应用户 id（去重）。B-09。
     */
    @Query("select distinct a.userId from SysUserAssignment a "
            + "where a.post.id = :postId and a.enabled = true")
    List<Long> findUserIdsByPostId(@Param("postId") Long postId);

    /**
     * 任职于某部门的启用任职对应用户 id（去重）。B-09。
     */
    @Query("select distinct a.userId from SysUserAssignment a "
            + "where a.dept.id = :deptId and a.enabled = true")
    List<Long> findUserIdsByDeptId(@Param("deptId") Long deptId);
}
