package com.xingchen.oa.office.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.office.dto.ApprovalCcResponse;
import com.xingchen.oa.office.dto.ApprovalCreateRequest;
import com.xingchen.oa.office.dto.ApprovalDoneResponse;
import com.xingchen.oa.office.dto.ApprovalLogResponse;
import com.xingchen.oa.office.dto.ApprovalResponse;
import com.xingchen.oa.office.entity.Approval;
import com.xingchen.oa.office.entity.ApprovalCc;
import com.xingchen.oa.office.entity.ApprovalLog;
import com.xingchen.oa.office.repository.ApprovalCcRepository;
import com.xingchen.oa.office.repository.ApprovalLogRepository;
import com.xingchen.oa.office.repository.ApprovalRepository;
import com.xingchen.oa.office.support.DeptNameResolver;
import com.xingchen.oa.office.support.SecuritySupport;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.LinkedHashMap;
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

    /**
     * 分页查询：status 条件 + 当前用户数据权限（DataScope）过滤。
     */
    public PageResult<ApprovalResponse> page(String status, int pageNum, int pageSize) {
        Page<Approval> page = approvalRepository.findAll(
                statusSpec(status).and(SecuritySupport.dataScope("deptId", "applicantId")),
                pageable(pageNum, pageSize));
        return toPageResult(page);
    }

    /**
     * 待办数量：同样走数据权限，status = PENDING。
     */
    public long pendingCount() {
        return approvalRepository.count(
                statusSpec(Approval.STATUS_PENDING).and(SecuritySupport.dataScope("deptId", "applicantId")));
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
        List<ApprovalLog> logs = logRepository.findByActorIdAndActionInOrderByCreatedAtDesc(userId, DONE_ACTIONS);
        Map<Long, ApprovalLog> latestByApproval = new LinkedHashMap<>();
        for (ApprovalLog log : logs) {
            latestByApproval.putIfAbsent(log.getApprovalId(), log);
        }
        List<ApprovalLog> ordered = List.copyOf(latestByApproval.values());
        int from = Math.min(Math.max(pageNum - 1, 0) * pageSize, ordered.size());
        int to = Math.min(from + pageSize, ordered.size());
        List<ApprovalLog> pageLogs = ordered.subList(from, to);

        Map<Long, Approval> approvals = approvalRepository
                .findAllById(pageLogs.stream().map(ApprovalLog::getApprovalId).toList())
                .stream().collect(Collectors.toMap(Approval::getId, Function.identity()));
        Map<Long, String> deptNames = deptNameResolver.nameMap();
        List<ApprovalDoneResponse> list = pageLogs.stream()
                .map(log -> {
                    Approval a = approvals.get(log.getApprovalId());
                    if (a == null) {
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
        return new PageResult<>(list, ordered.size(), pageNum, pageSize);
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
        return toResponse(saved, deptNameResolver.nameMap());
    }

    @Transactional
    public ApprovalResponse approve(Long id, String comment) {
        Approval approval = pendingApproval(id);
        approval.setStatus(Approval.STATUS_APPROVED);
        addLog(id, ApprovalLog.ACTION_APPROVE, comment);
        return toResponse(approvalRepository.save(approval), deptNameResolver.nameMap());
    }

    @Transactional
    public ApprovalResponse reject(Long id, String reason) {
        if (!StringUtils.hasText(reason)) {
            throw new BusinessException(400, "驳回原因不能为空");
        }
        Approval approval = pendingApproval(id);
        approval.setStatus(Approval.STATUS_REJECTED);
        addLog(id, ApprovalLog.ACTION_REJECT, reason);
        return toResponse(approvalRepository.save(approval), deptNameResolver.nameMap());
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
        addLog(id, ApprovalLog.ACTION_WITHDRAW, null);
        return toResponse(approvalRepository.save(approval), deptNameResolver.nameMap());
    }

    public List<ApprovalLogResponse> logs(Long id) {
        if (!approvalRepository.existsById(id)) {
            throw new BusinessException(404, "审批单不存在");
        }
        return logRepository.findByApprovalIdOrderByCreatedAtAsc(id).stream()
                .map(log -> new ApprovalLogResponse(
                        log.getAction(), log.getActorName(), log.getComment(), log.getCreatedAt()))
                .toList();
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
        List<ApprovalResponse> list = page.getContent().stream()
                .map(a -> toResponse(a, deptNames))
                .toList();
        return new PageResult<>(list, page.getTotalElements(), page.getNumber() + 1, page.getSize());
    }

    private String deptName(Approval approval, Map<Long, String> deptNames) {
        return approval.getDeptId() != null ? deptNames.get(approval.getDeptId()) : null;
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
