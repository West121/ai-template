package com.hentor.oa.office.service;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.fieldperm.FieldPermMasker;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.DataScope;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.office.dto.ApprovalCcResponse;
import com.hentor.oa.office.dto.ApprovalCreateRequest;
import com.hentor.oa.office.dto.ApprovalDoneResponse;
import com.hentor.oa.office.dto.ApprovalLogResponse;
import com.hentor.oa.office.dto.ApprovalResponse;
import com.hentor.oa.office.entity.Approval;
import com.hentor.oa.office.entity.ApprovalCc;
import com.hentor.oa.office.entity.ApprovalLog;
import com.hentor.oa.office.repository.ApprovalCcRepository;
import com.hentor.oa.office.repository.ApprovalLogRepository;
import com.hentor.oa.office.repository.ApprovalRepository;
import com.hentor.oa.office.support.DataScopeSupport;
import com.hentor.oa.system.fieldperm.FieldPermService;
import com.hentor.oa.office.support.DeptNameResolver;
import com.hentor.oa.office.support.SecuritySupport;
import jakarta.persistence.OptimisticLockException;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ApprovalService {

    private static final List<String> DONE_ACTIONS = List.of(ApprovalLog.ACTION_APPROVE, ApprovalLog.ACTION_REJECT);


    private final ApprovalRepository approvalRepository;
    private final ApprovalLogRepository logRepository;
    private final ApprovalCcRepository ccRepository;
    private final DeptNameResolver deptNameResolver;
    private final DataScopeSupport dataScopeSupport;
    private final FieldPermService fieldPermService;

    /** P3 字段权限功能键：与「我的审批」(WORKFLOW_TASKS) 同键（审批中心页已并入 /workflow/tasks；配置/目录/执行三处同键）。 */
    private static final String FIELD_PERM_FEATURE = "WORKFLOW_TASKS";

    /**
     * 分页查询：status 条件 + 当前用户<b>多维</b>数据权限过滤（部门维 AND 成本中心/项目维）。
     */
    public PageResult<ApprovalResponse> page(String status, int pageNum, int pageSize) {
        Page<Approval> page = approvalRepository.findAll(
                statusSpec(status).and(dataScopeSupport.multiDim("WORKFLOW_TASKS", "Approval", "deptId", "applicantId")),
                pageable(pageNum, pageSize));
        return toPageResult(page);
    }

    /**
     * 待办数量：同样走多维数据权限，status = PENDING。
     */
    public long pendingCount() {
        return approvalRepository.count(
                statusSpec(Approval.STATUS_PENDING).and(dataScopeSupport.multiDim("WORKFLOW_TASKS", "Approval", "deptId", "applicantId")));
    }

    /**
     * 我发起的（不走数据权限，applicant_id = 当前用户）。
     */
    public PageResult<ApprovalResponse> my(String status, int pageNum, int pageSize) {
        Long userId = SecuritySupport.currentUser().getUserId();
        Specification<Approval> spec = statusSpec(status)
                .and((root, query, cb) -> cb.equal(root.get("applicantId"), userId));
        return toPageResult(approvalRepository.findAll(spec, pageable(pageNum, pageSize)));
    }

    /**
     * 我处理过的：依据操作日志（APPROVE / REJECT），按单去重保留最近一次操作。
     */
    public PageResult<ApprovalDoneResponse> done(int pageNum, int pageSize) {
        Long userId = SecuritySupport.currentUser().getUserId();
        // B-08：分页下推。total=去重后的审批单数（与原 ordered.size() 一致）；
        // 当前页 = 去重后按最近操作时间倒序的审批单 id 分页。
        long total = logRepository.countDistinctApprovalByActor(userId, DONE_ACTIONS);
        List<Long> pageApprovalIds = logRepository.findDistinctApprovalIdsByActor(
                userId, DONE_ACTIONS, PageRequest.of(Math.max(pageNum - 1, 0), pageSize));
        if (pageApprovalIds.isEmpty()) {
            return new PageResult<>(List.of(), total, pageNum, pageSize);
        }
        // 仅对当前页这批单，取每单该操作人最近一次操作（myAction/actedAt）。
        Map<Long, ApprovalLog> latestByApproval = new HashMap<>();
        for (ApprovalLog log : logRepository
                .findByActorIdAndActionInAndApprovalIdInOrderByCreatedAtDesc(userId, DONE_ACTIONS, pageApprovalIds)) {
            latestByApproval.putIfAbsent(log.getApprovalId(), log);
        }
        Map<Long, Approval> approvals = approvalRepository
                .findAllById(pageApprovalIds)
                .stream().collect(Collectors.toMap(Approval::getId, Function.identity()));
        Map<Long, String> deptNames = deptNameResolver.nameMap();
        // 保持查询给定的顺序（按最近操作时间倒序）。
        List<ApprovalDoneResponse> list = pageApprovalIds.stream()
                .map(approvalId -> {
                    Approval a = approvals.get(approvalId);
                    ApprovalLog log = latestByApproval.get(approvalId);
                    if (a == null || log == null) {
                        return null;
                    }
                    return new ApprovalDoneResponse(
                            a.getId(), a.getTitle(), a.getType(), a.getApplicant(), a.getApplicantId(),
                            a.getStatus(), a.getReason(), a.getDeptId(), deptName(a, deptNames),
                            a.getStartDate(), a.getEndDate(), a.getCreatedAt(),
                            log.getAction(), log.getCreatedAt());
                })
                .filter(Objects::nonNull)
                .toList();
        return new PageResult<>(list, total, pageNum, pageSize);
    }

    /**
     * 抄送我的。
     */
    public PageResult<ApprovalCcResponse> cc(int pageNum, int pageSize) {
        Long userId = SecuritySupport.currentUser().getUserId();
        Page<ApprovalCc> page = ccRepository.findByUserId(userId,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        Map<Long, Approval> approvals = approvalRepository
                .findAllById(page.getContent().stream().map(ApprovalCc::getApprovalId).toList())
                .stream().collect(Collectors.toMap(Approval::getId, Function.identity()));
        Map<Long, String> deptNames = deptNameResolver.nameMap();
        List<ApprovalCcResponse> list = page.getContent().stream()
                .map(cc -> {
                    Approval a = approvals.get(cc.getApprovalId());
                    if (a == null) {
                        return null;
                    }
                    return new ApprovalCcResponse(
                            a.getId(), a.getTitle(), a.getType(), a.getApplicant(), a.getApplicantId(),
                            a.getStatus(), a.getReason(), a.getDeptId(), deptName(a, deptNames),
                            a.getStartDate(), a.getEndDate(), a.getCreatedAt(),
                            cc.getReadFlag());
                })
                .filter(Objects::nonNull)
                .toList();
        return new PageResult<>(list, page.getTotalElements(), pageNum, pageSize);
    }

    @Transactional
    public void markCcRead(Long approvalId) {
        Long userId = SecuritySupport.currentUser().getUserId();
        List<ApprovalCc> rows = ccRepository.findByApprovalIdAndUserId(approvalId, userId);
        rows.forEach(cc -> cc.setReadFlag(true));
        ccRepository.saveAll(rows);
    }

    @Transactional
    public void markAllCcRead() {
        Long userId = SecuritySupport.currentUser().getUserId();
        List<ApprovalCc> rows = ccRepository.findByUserIdAndReadFlagFalse(userId);
        rows.forEach(cc -> cc.setReadFlag(true));
        ccRepository.saveAll(rows);
    }

    @Transactional
    public ApprovalResponse create(ApprovalCreateRequest request) {
        UserContext context = SecuritySupport.currentUser();
        Approval approval = new Approval();
        approval.setTitle(request.title());
        approval.setType(request.type());
        approval.setReason(request.reason());
        approval.setApplicant(SecuritySupport.displayName(context));
        approval.setStatus(Approval.STATUS_PENDING);
        approval.setApplicantId(context.getUserId());
        approval.setDeptId(context.getActiveDeptId());
        approval.setStartDate(request.startDate());
        approval.setEndDate(request.endDate());
        Approval saved = approvalRepository.save(approval);

        if (request.ccUserIds() != null) {
            List<ApprovalCc> ccRows = request.ccUserIds().stream()
                    .filter(Objects::nonNull)
                    .distinct()
                    .map(uid -> {
                        ApprovalCc cc = new ApprovalCc();
                        cc.setApprovalId(saved.getId());
                        cc.setUserId(uid);
                        cc.setReadFlag(false);
                        return cc;
                    })
                    .toList();
            ccRepository.saveAll(ccRows);
        }
        addLog(saved.getId(), ApprovalLog.ACTION_CREATE, null);
        return masked(toResponse(saved, deptNameResolver.nameMap()), fieldPermService.invisibleFields(FIELD_PERM_FEATURE));
    }

    @Transactional
    public ApprovalResponse approve(Long id, String comment) {
        Approval approval = pendingApproval(id);
        approval.setStatus(Approval.STATUS_APPROVED);
        // B-07：先做版本敏感的状态推进（saveAndFlush 触发 UPDATE ... WHERE version=?），
        // 冲突转 409；胜出后再记日志，避免败者写入审计日志（且随事务回滚）。
        Approval saved = saveWithOptimisticLock(approval);
        addLog(id, ApprovalLog.ACTION_APPROVE, comment);
        return masked(toResponse(saved, deptNameResolver.nameMap()), fieldPermService.invisibleFields(FIELD_PERM_FEATURE));
    }

    @Transactional
    public ApprovalResponse reject(Long id, String reason) {
        if (!StringUtils.hasText(reason)) {
            throw new BusinessException(400, "驳回原因不能为空");
        }
        Approval approval = pendingApproval(id);
        approval.setStatus(Approval.STATUS_REJECTED);
        Approval saved = saveWithOptimisticLock(approval);
        addLog(id, ApprovalLog.ACTION_REJECT, reason);
        return masked(toResponse(saved, deptNameResolver.nameMap()), fieldPermService.invisibleFields(FIELD_PERM_FEATURE));
    }

    /**
     * 撤回：仅本人且 PENDING。
     */
    @Transactional
    public ApprovalResponse withdraw(Long id) {
        UserContext context = SecuritySupport.currentUser();
        Approval approval = approvalRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "审批单不存在"));
        if (!Objects.equals(approval.getApplicantId(), context.getUserId())) {
            throw new BusinessException(403, "仅申请人本人可撤回");
        }
        if (!Approval.STATUS_PENDING.equals(approval.getStatus())) {
            throw new BusinessException(400, "仅待审批的单据可撤回");
        }
        approval.setStatus(Approval.STATUS_WITHDRAWN);
        Approval saved = saveWithOptimisticLock(approval);
        addLog(id, ApprovalLog.ACTION_WITHDRAW, null);
        return masked(toResponse(saved, deptNameResolver.nameMap()), fieldPermService.invisibleFields(FIELD_PERM_FEATURE));
    }

    /**
     * 版本敏感保存（B-07）：并发状态推进冲突时 Hibernate 抛乐观锁异常，转 409。
     * saveAndFlush 使 UPDATE 立即执行，冲突在本方法内抛出并被捕获（否则将延迟到事务提交、越过 try）。
     */
    private Approval saveWithOptimisticLock(Approval approval) {
        try {
            return approvalRepository.saveAndFlush(approval);
        } catch (OptimisticLockingFailureException | OptimisticLockException e) {
            throw new BusinessException(409, "该审批单已被其他人处理，请刷新后重试");
        }
    }

    /**
     * 流转记录（B-05 越权修复）：仅发起人 / 审批人（已操作或数据权限内待办可见）/ 抄送人可读，
     * 无关用户返回 403。
     */
    public List<ApprovalLogResponse> logs(Long id) {
        Approval approval = approvalRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "审批单不存在"));
        List<ApprovalLog> logs = logRepository.findByApprovalIdOrderByCreatedAtAsc(id);
        if (!canViewLogs(approval, logs, SecuritySupport.currentUser())) {
            throw new BusinessException(403, "无权查看该审批单的流转记录");
        }
        return logs.stream()
                .map(log -> new ApprovalLogResponse(
                        log.getAction(), log.getActorName(), log.getComment(), log.getCreatedAt()))
                .toList();
    }

    /**
     * 归属校验：发起人本人 / 曾操作过该单的审批人 / 抄送人 / 数据权限范围覆盖该单
     * （即待办列表里本就可见，如部门经理对本部门单据）。
     */
    private boolean canViewLogs(Approval approval, List<ApprovalLog> logs, UserContext user) {
        Long userId = user.getUserId();
        if (Objects.equals(approval.getApplicantId(), userId)) {
            return true;
        }
        if (logs.stream().anyMatch(log -> Objects.equals(log.getActorId(), userId))) {
            return true;
        }
        if (!ccRepository.findByApprovalIdAndUserId(approval.getId(), userId).isEmpty()) {
            return true;
        }
        DataScope scope = user.getDataScope();
        if (scope == null) {
            return false;
        }
        if (scope.all()) {
            return true;
        }
        return !scope.selfOnly()
                && approval.getDeptId() != null
                && scope.deptIds().contains(approval.getDeptId());
    }

    private Approval pendingApproval(Long id) {
        Approval approval = approvalRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "审批单不存在"));
        if (!Approval.STATUS_PENDING.equals(approval.getStatus())) {
            throw new BusinessException(400, "该审批单已处理，不能重复操作");
        }
        return approval;
    }

    private void addLog(Long approvalId, String action, String comment) {
        UserContext context = SecuritySupport.currentUser();
        ApprovalLog log = new ApprovalLog();
        log.setApprovalId(approvalId);
        log.setActorId(context.getUserId());
        log.setActorName(SecuritySupport.displayName(context));
        log.setAction(action);
        log.setComment(StringUtils.hasText(comment) ? comment : null);
        logRepository.save(log);
    }

    private Specification<Approval> statusSpec(String status) {
        return (root, query, cb) -> StringUtils.hasText(status)
                ? cb.equal(root.get("status"), status)
                : cb.conjunction();
    }

    private Pageable pageable(int pageNum, int pageSize) {
        return PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "createdAt"));
    }

    private PageResult<ApprovalResponse> toPageResult(Page<Approval> page) {
        Map<Long, String> deptNames = deptNameResolver.nameMap();
        java.util.Set<String> invisible = fieldPermService.invisibleFields(FIELD_PERM_FEATURE); // P3 每页解析一次
        List<ApprovalResponse> list = page.getContent().stream()
                .map(a -> masked(toResponse(a, deptNames), invisible))
                .toList();
        return new PageResult<>(list, page.getTotalElements(), page.getNumber() + 1, page.getSize());
    }

    private String deptName(Approval approval, Map<Long, String> deptNames) {
        return approval.getDeptId() != null ? deptNames.get(approval.getDeptId()) : null;
    }

    /** P3 出口脱敏：@FieldPerm 标注且 visible=false 的列置 null（record 重建，失败安全）。 */
    private ApprovalResponse masked(ApprovalResponse r, java.util.Set<String> invisible) {
        return FieldPermMasker.mask(r, invisible);
    }

    private ApprovalResponse toResponse(Approval approval, Map<Long, String> deptNames) {
        return new ApprovalResponse(
                approval.getId(),
                approval.getTitle(),
                approval.getType(),
                approval.getApplicant(),
                approval.getApplicantId(),
                approval.getStatus(),
                approval.getReason(),
                approval.getDeptId(),
                deptName(approval, deptNames),
                approval.getStartDate(),
                approval.getEndDate(),
                approval.getCreatedAt());
    }
}
