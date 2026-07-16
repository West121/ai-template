package com.hentor.oa.workflow.repository;

import com.hentor.oa.workflow.entity.WfInstanceExt;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

public interface WfInstanceExtRepository extends JpaRepository<WfInstanceExt, Long> {

    Optional<WfInstanceExt> findByProcInstId(String procInstId);

    /** 批E 审批风险：同流程 + 同部门近 N 天实例（金额分位阈值取样，排除草稿）。 */
    List<WfInstanceExt> findByDefCodeAndInitiatorDeptIdAndCreatedAtAfter(
            String defCode, Long initiatorDeptId, OffsetDateTime createdAt);

    /** 批E 审批风险：同申请人 + 同流程近 N 天发起次数（高频申请识别，含草稿无妨）。 */
    long countByDefCodeAndInitiatorIdAndCreatedAtAfter(
            String defCode, Long initiatorId, OffsetDateTime createdAt);

    Page<WfInstanceExt> findByInitiatorId(Long initiatorId, Pageable pageable);

    /** B-17：当前用户发起的全部实例 proc_inst_id（判定可见实例范围）。 */
    @Query("select i.procInstId from WfInstanceExt i where i.initiatorId = :initiatorId")
    java.util.List<String> findProcInstIdsByInitiatorId(@Param("initiatorId") Long initiatorId);

    Page<WfInstanceExt> findByInitiatorIdAndBizStatus(Long initiatorId, String bizStatus, Pageable pageable);

    /** 我发起 + keyword（标题/流程名模糊）。 */
    @Query("select i from WfInstanceExt i where i.initiatorId = :uid "
            + "and (:kw is null or i.title like %:kw% or i.defName like %:kw%)")
    Page<WfInstanceExt> searchByInitiator(@Param("uid") Long uid, @Param("kw") String kw, Pageable pageable);

    /** 我的草稿 + keyword。 */
    @Query("select i from WfInstanceExt i where i.initiatorId = :uid and i.bizStatus = :status "
            + "and (:kw is null or i.title like %:kw% or i.defName like %:kw%)")
    Page<WfInstanceExt> searchByInitiatorAndStatus(@Param("uid") Long uid, @Param("status") String status,
                                                   @Param("kw") String kw, Pageable pageable);

    /** 管理员实例检索：status/keyword 均可空。 */
    @Query("select i from WfInstanceExt i where (:status is null or i.bizStatus = :status) "
            + "and (:kw is null or i.title like %:kw% or i.defName like %:kw%)")
    Page<WfInstanceExt> adminSearch(@Param("status") String status, @Param("kw") String kw, Pageable pageable);

    /**
     * 关联表单记录：按表单编码查已提交（非 DRAFT）的实例，keyword 匹配标题；id 降序。
     * 表单被绑定到流程后，实例的 form_code 即该表单编码；未被任何流程使用则查无记录。
     */
    @Query("select i from WfInstanceExt i where i.formCode = :formCode and i.bizStatus <> 'DRAFT' "
            + "and (:kw is null or i.title like %:kw%) order by i.id desc")
    Page<WfInstanceExt> findFormRecords(@Param("formCode") String formCode, @Param("kw") String kw, Pageable pageable);

    /** 监控总览：按业务状态分组计数，返回 [bizStatus, count]。 */
    @Query("select i.bizStatus, count(i) from WfInstanceExt i group by i.bizStatus")
    java.util.List<Object[]> countGroupByStatus();

    /** 监控总览：按流程定义分组计数（排除草稿），返回 [defCode, defName, count]，count 降序。 */
    @Query("select i.defCode, i.defName, count(i) from WfInstanceExt i where i.bizStatus <> 'DRAFT' "
            + "group by i.defCode, i.defName order by count(i) desc")
    java.util.List<Object[]> countGroupByDef();
}
