package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.SysDeptRetention;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface SysDeptRetentionRepository extends JpaRepository<SysDeptRetention, Long> {

    /** 某用户当前仍在保留期内的旧部门 id（过期自动排除 → 收敛）。折入数据权限部门维可见集。 */
    @Query("select r.deptId from SysDeptRetention r where r.userId = :userId and r.expireAt > :now")
    List<Long> findActiveDeptIds(@Param("userId") Long userId, @Param("now") LocalDateTime now);

    void deleteByUserIdAndDeptId(Long userId, Long deptId);

    void deleteByUserId(Long userId);
}
