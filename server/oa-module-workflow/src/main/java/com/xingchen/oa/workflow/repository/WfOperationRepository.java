package com.xingchen.oa.workflow.repository;

import com.xingchen.oa.workflow.entity.WfOperation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface WfOperationRepository extends JpaRepository<WfOperation, Long> {

    List<WfOperation> findByProcInstIdOrderByCreatedAtAsc(String procInstId);

    /** B-17：当前用户曾操作过的实例（去重 proc_inst_id），用于判定其可见实例范围。 */
    @Query("select distinct o.procInstId from WfOperation o where o.actorId = :actorId")
    List<String> findDistinctProcInstIdByActorId(@Param("actorId") Long actorId);

    /** B-17：取指定实例集合的操作明细 JSON（用于扫描 attachments 引用），只取非空明细。 */
    @Query("select o.detailJson from WfOperation o where o.procInstId in :pids and o.detailJson is not null")
    List<String> findDetailJsonByProcInstIds(@Param("pids") Collection<String> pids);
}
