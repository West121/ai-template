package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.SysUserLeader;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

/**
 * 用户指定直属上级仓库（sys_user_leader）。
 */
public interface SysUserLeaderRepository extends JpaRepository<SysUserLeader, Long> {

    /**
     * 某用户配置的直属上级 id（按 sort_order 有序）。供 CRUD 回读与 LEADER 节点解析共用。
     */
    @Query("select l.leaderId from SysUserLeader l where l.userId = :userId order by l.sortOrder asc")
    List<Long> findLeaderIdsByUserId(@Param("userId") Long userId);

    /**
     * 删除某用户的全部直属上级配置（全量替换/删除用户时用）。
     * 用 bulk @Modifying：立即执行 DELETE，避免 Hibernate 同事务「先 INSERT 后 DELETE」的 flush 顺序
     * 与 uk(user_id,leader_id) 冲突（全量替换 delete-then-insert 必须 delete 先落库）。
     */
    @Modifying
    @Query("delete from SysUserLeader l where l.userId = :userId")
    void deleteByUserId(@Param("userId") Long userId);

    /** 删除以某用户为上级的全部配置（删除用户时清理悬挂引用）。 */
    @Modifying
    @Query("delete from SysUserLeader l where l.leaderId = :leaderId")
    void deleteByLeaderId(@Param("leaderId") Long leaderId);
}
