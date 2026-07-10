package com.xingchen.oa.office.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.office.dto.gongwen.ArchiveRequest;
import com.xingchen.oa.office.dto.gongwen.CirculateRequest;
import com.xingchen.oa.office.dto.gongwen.DocDetailResponse;
import com.xingchen.oa.office.dto.gongwen.GongwenListItem;
import com.xingchen.oa.office.dto.gongwen.LedgerResponse;
import com.xingchen.oa.office.dto.gongwen.NumberRuleResponse;
import com.xingchen.oa.office.dto.gongwen.OpinionRequest;
import com.xingchen.oa.office.dto.gongwen.ReadReceiptRequest;
import com.xingchen.oa.office.dto.gongwen.RecvRegisterRequest;
import com.xingchen.oa.office.dto.gongwen.RenderResponse;
import com.xingchen.oa.office.dto.gongwen.SealRequest;
import com.xingchen.oa.office.dto.gongwen.SendDraftRequest;
import com.xingchen.oa.office.dto.gongwen.TemplateResponse;
import com.xingchen.oa.office.entity.DocCirculation;
import com.xingchen.oa.office.entity.DocNumberLedger;
import com.xingchen.oa.office.entity.DocOpinion;
import com.xingchen.oa.office.entity.DocTemplate;
import com.xingchen.oa.office.entity.Document;
import com.xingchen.oa.office.repository.DocCirculationRepository;
import com.xingchen.oa.office.repository.DocNumberLedgerRepository;
import com.xingchen.oa.office.repository.DocOpinionRepository;
import com.xingchen.oa.office.repository.DocTemplateRepository;
import com.xingchen.oa.office.repository.DocumentRepository;
import com.xingchen.oa.office.support.DeptNameResolver;
import com.xingchen.oa.office.support.SecuritySupport;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import org.flowable.engine.HistoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.engine.history.HistoricActivityInstance;
import org.flowable.engine.runtime.Execution;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.task.api.Task;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 中国式公文办文编排：发文 gw_send / 收文 gw_recv 两条 Flowable 流程，
 * businessKey = "GW:" + documentId；节点办理回写公文（占号/用印/成文/批办/传阅/办结/归档）。
 * 复用平台单例 Flowable 引擎（RuntimeService/TaskService），不依赖 oa-module-workflow 业务模块。
 */
@Service
@RequiredArgsConstructor
public class GongwenService {

    private static final String SEND_KEY = "gw_send";
    private static final String RECV_KEY = "gw_recv";
    private static final String BIZ_PREFIX = "GW:";

    private final DocumentRepository documentRepository;
    private final DocOpinionRepository opinionRepository;
    private final DocCirculationRepository circulationRepository;
    private final DocTemplateRepository templateRepository;
    private final DocNumberLedgerRepository ledgerRepository;
    private final DocNumberService docNumberService;
    private final GongwenRenderer renderer;
    private final DeptNameResolver deptNameResolver;
    private final RuntimeService runtimeService;
    private final TaskService taskService;
    private final HistoryService historyService;

    @PersistenceContext
    private EntityManager entityManager;

    // ==================== 发文：拟稿 ====================

    @Transactional
    public DocDetailResponse draft(SendDraftRequest req) {
        UserContext ctx = SecuritySupport.currentUser();
        Document d = new Document();
        d.setDirection(Document.DIRECTION_SEND);
        d.setStatus(Document.STATUS_DRAFT);
        d.setCode("待编号");
        d.setTitle(req.title());
        d.setDocType(req.docType());
        d.setIssuingOrg(req.issuingOrg());
        d.setMainRecipients(req.mainRecipients());
        d.setUnit(req.mainRecipients());
        d.setCcRecipients(req.ccRecipients());
        d.setSecret(StringUtils.hasText(req.secret()) ? req.secret() : "INTERNAL");
        d.setUrgency(StringUtils.hasText(req.urgency()) ? req.urgency() : "NORMAL");
        d.setCopyNo(req.copyNo());
        d.setIssuer(req.issuer());
        d.setAnnotation(req.annotation());
        d.setContent(req.content());
        d.setAttachments(req.attachments());
        d.setTemplateId(req.templateId() != null ? req.templateId() : defaultTemplateId());
        d.setSealStatus(Document.SEAL_NONE);
        d.setArchived(false);
        d.setDrafter(SecuritySupport.displayName(ctx));
        d.setDocDate(LocalDate.now());
        d.setDeptId(ctx.getActiveDeptId());
        d.setCreatorId(ctx.getUserId());
        d = documentRepository.save(d);

        // AssigneeResolver 取人上下文：initiatorId/initiatorDeptId 供 LEADER/INITIATOR/ROLE 等规则运行时求值。
        // initiatorName + 实例名(title)写入共享 Flowable 引擎，供通用待办在无 wf_instance_ext 时回退展示。
        Map<String, Object> vars = new HashMap<>();
        vars.put("initiatorId", ctx.getUserId());
        vars.put("initiatorDeptId", ctx.getActiveDeptId());
        vars.put("initiatorName", SecuritySupport.displayName(ctx));
        vars.put("needCountersign", Boolean.TRUE.equals(req.needCountersign()));
        if (req.numberRuleId() != null) {
            vars.put("numberRuleId", req.numberRuleId());
        }
        ProcessInstance pi = runtimeService.startProcessInstanceByKey(
                SEND_KEY, BIZ_PREFIX + d.getId(), vars);
        runtimeService.setProcessInstanceName(pi.getId(), d.getTitle());
        d.setProcessInstanceId(pi.getProcessInstanceId());
        d.setStatus(Document.STATUS_REVIEWING);
        documentRepository.save(d);

        recordOpinion(d.getId(), "draft", ctx, "拟稿提交", DocOpinion.DECISION_APPROVE);
        return detail(d.getId());
    }

    // ==================== 收文：登记 ====================

    @Transactional
    public DocDetailResponse register(RecvRegisterRequest req) {
        UserContext ctx = SecuritySupport.currentUser();
        Document d = new Document();
        d.setDirection(Document.DIRECTION_RECEIVE);
        d.setStatus(Document.STATUS_REGISTERED);
        d.setCode(StringUtils.hasText(req.code()) ? req.code() : "待登记");
        d.setTitle(req.title());
        d.setUnit(req.unit());
        d.setDocType(req.docType());
        d.setSecret(StringUtils.hasText(req.secret()) ? req.secret() : "INTERNAL");
        d.setUrgency(StringUtils.hasText(req.urgency()) ? req.urgency() : "NORMAL");
        d.setContent(req.content());
        d.setSealStatus(Document.SEAL_NONE);
        d.setArchived(false);
        d.setDrafter(SecuritySupport.displayName(ctx));
        d.setDocDate(LocalDate.now());
        d.setDeptId(ctx.getActiveDeptId());
        d.setCreatorId(ctx.getUserId());
        d = documentRepository.save(d);

        Map<String, Object> vars = new HashMap<>();
        vars.put("initiatorId", ctx.getUserId());
        vars.put("initiatorDeptId", ctx.getActiveDeptId());
        vars.put("initiatorName", SecuritySupport.displayName(ctx));
        vars.put("needCirculate", Boolean.TRUE.equals(req.needCirculate()));
        ProcessInstance pi = runtimeService.startProcessInstanceByKey(
                RECV_KEY, BIZ_PREFIX + d.getId(), vars);
        runtimeService.setProcessInstanceName(pi.getId(), d.getTitle());
        d.setProcessInstanceId(pi.getProcessInstanceId());
        d.setStatus(Document.STATUS_ASSIGNING);
        documentRepository.save(d);

        recordOpinion(d.getId(), "register", ctx, "收文登记", DocOpinion.DECISION_APPROVE);
        return detail(d.getId());
    }

    // ==================== 通用：提交意见并办理当前节点 ====================

    @Transactional
    public DocDetailResponse opinion(Long id, OpinionRequest req) {
        Document d = get(id);
        requireProcess(d);
        Task task = activeTask(d);
        if (task == null) {
            throw new BusinessException(400, "该公文当前无待办环节");
        }
        String key = task.getTaskDefinitionKey();
        if ("seal".equals(key)) {
            throw new BusinessException(400, "用印环节请调用 /seal");
        }
        if ("circulate".equals(key)) {
            throw new BusinessException(400, "传阅环节请调用 /circulate");
        }
        requirePerm(permForTask(key));

        UserContext ctx = SecuritySupport.currentUser();
        String decision = StringUtils.hasText(req.decision())
                ? req.decision().toUpperCase() : DocOpinion.DECISION_APPROVE;
        recordOpinion(id, key, ctx, req.opinion(), decision);

        switch (decision) {
            case DocOpinion.DECISION_REJECT -> {
                runtimeService.deleteProcessInstance(d.getProcessInstanceId(),
                        "退回：" + (req.opinion() == null ? "" : req.opinion()));
                d.setProcessInstanceId(null);
                d.setStatus(Document.DIRECTION_SEND.equals(d.getDirection())
                        ? Document.STATUS_DRAFT : Document.STATUS_REGISTERED);
                documentRepository.save(d);
            }
            case DocOpinion.DECISION_TRANSFER -> {
                if (req.targetUserId() == null) {
                    throw new BusinessException(400, "转办须指定 targetUserId");
                }
                taskService.setAssignee(task.getId(), String.valueOf(req.targetUserId()));
                // 转办不推进流程，仅换人
            }
            default -> {
                // 签发节点：占号 + 回写文号（幂等）
                if ("issue".equals(key)) {
                    Long ruleId = readLong(d.getProcessInstanceId(), "numberRuleId");
                    String number = docNumberService.allocate(ruleId, d.getDocType(),
                            id, d.getTitle(), SecuritySupport.displayName(ctx));
                    d.setCode(number);
                    d.setSigner(SecuritySupport.displayName(ctx));
                    if (!StringUtils.hasText(d.getIssuer())) {
                        d.setIssuer(SecuritySupport.displayName(ctx));
                    }
                }
                taskService.complete(task.getId());
                applyStatusAfter(d, key);
                documentRepository.save(d);
            }
        }
        return detail(id);
    }

    // ==================== 用印 ====================

    @Transactional
    public DocDetailResponse seal(Long id, SealRequest req) {
        Document d = get(id);
        requireProcess(d);
        Task task = activeTask(d);
        if (task == null || !"seal".equals(task.getTaskDefinitionKey())) {
            throw new BusinessException(400, "该公文当前不在用印环节");
        }
        UserContext ctx = SecuritySupport.currentUser();
        recordOpinion(id, "seal", ctx, req != null ? req.opinion() : null, DocOpinion.DECISION_APPROVE);
        d.setSealStatus(Document.SEAL_SEALED);
        d.setSealedBy(SecuritySupport.displayName(ctx));
        d.setSealedAt(LocalDateTime.now());
        d.setStatus(Document.STATUS_SEALED);
        documentRepository.save(d);
        taskService.complete(task.getId());
        return detail(id);
    }

    // ==================== 传阅 ====================

    @Transactional
    public DocDetailResponse circulate(Long id, CirculateRequest req) {
        Document d = get(id);
        requireProcess(d);
        Task task = activeTask(d);
        if (task == null || !"circulate".equals(task.getTaskDefinitionKey())) {
            throw new BusinessException(400, "该公文当前不在传阅环节");
        }
        if (req == null || CollectionUtils.isEmpty(req.readers())) {
            throw new BusinessException(400, "请指定传阅读者");
        }
        UserContext ctx = SecuritySupport.currentUser();
        for (CirculateRequest.Reader r : req.readers()) {
            DocCirculation c = new DocCirculation();
            c.setDocumentId(id);
            c.setReaderId(r.id());
            c.setReaderName(r.name());
            c.setStatus(DocCirculation.STATUS_PENDING);
            circulationRepository.save(c);
        }
        recordOpinion(id, "circulate", ctx, "发起传阅 " + req.readers().size() + " 人",
                DocOpinion.DECISION_APPROVE);
        d.setStatus(Document.STATUS_CIRCULATING);
        documentRepository.save(d);
        taskService.complete(task.getId());
        return detail(id);
    }

    @Transactional
    public DocDetailResponse readReceipt(Long circulationId, ReadReceiptRequest req) {
        DocCirculation c = circulationRepository.findById(circulationId)
                .orElseThrow(() -> new BusinessException(404, "传阅记录不存在"));
        c.setStatus(DocCirculation.STATUS_READ);
        c.setReadAt(LocalDateTime.now());
        if (req != null && StringUtils.hasText(req.opinion())) {
            c.setOpinion(req.opinion());
        }
        circulationRepository.save(c);
        return detail(c.getDocumentId());
    }

    // ==================== 催办 ====================

    /**
     * 催办：对当前待办环节的承办人发催办提醒（收文超时未办）。留痕一条 urge 意见，
     * 并尽力向 wf_notify 投递一条 TODO 催办（best-effort，失败不阻断）。
     */
    @Transactional
    public DocDetailResponse urge(Long id) {
        Document d = get(id);
        requireProcess(d);
        Task task = activeTask(d);
        if (task == null) {
            throw new BusinessException(400, "该公文当前无待办环节，无需催办");
        }
        UserContext ctx = SecuritySupport.currentUser();
        recordOpinion(id, "urge", ctx, "催办：请尽快办理「" + task.getName() + "」", "URGE");
        Long assignee = parseLong(task.getAssignee());
        if (assignee != null) {
            notifyBestEffort(assignee, "催办：" + d.getTitle(),
                    "您有一条公文待办「" + task.getName() + "」已被催办，请尽快处理", d.getProcessInstanceId());
        }
        return detail(id);
    }

    // ==================== 归档 ====================

    @Transactional
    public DocDetailResponse archive(Long id, ArchiveRequest req) {
        Document d = get(id);
        if (!Document.STATUS_FINISHED.equals(d.getStatus())
                && !Document.STATUS_PUBLISHED.equals(d.getStatus())) {
            throw new BusinessException(400, "仅办结或成文的公文可归档");
        }
        String category = (req != null && StringUtils.hasText(req.category())) ? req.category()
                : (Document.DIRECTION_SEND.equals(d.getDirection()) ? "发文" : "收文");
        String archiveNo = LocalDate.now().getYear() + "-" + category + "-"
                + String.format("%04d", d.getId());
        d.setArchived(true);
        d.setArchiveNo(archiveNo);
        d.setArchivedAt(LocalDateTime.now());
        d.setStatus(Document.STATUS_ARCHIVED);
        documentRepository.save(d);
        return detail(id);
    }

    // ==================== 详情 / 列表 / 台账 ====================

    public DocDetailResponse detail(Long id) {
        Document d = get(id);
        String deptName = d.getDeptId() != null ? deptNameResolver.name(d.getDeptId()) : null;

        DocDetailResponse.CurrentTask currentTask = null;
        DocDetailResponse.Highlight highlight = new DocDetailResponse.Highlight(List.of(), List.of());
        if (StringUtils.hasText(d.getProcessInstanceId())) {
            Task t = activeTask(d);
            if (t != null) {
                currentTask = new DocDetailResponse.CurrentTask(
                        t.getId(), t.getTaskDefinitionKey(), t.getName(), t.getAssignee());
            }
            highlight = computeHighlight(d.getProcessInstanceId());
        }

        List<DocDetailResponse.TimelineItem> timeline = opinionRepository
                .findByDocumentIdOrderByIdAsc(id).stream()
                .map(o -> new DocDetailResponse.TimelineItem(o.getId(), o.getTaskKey(), o.getUserId(),
                        o.getUserName(), o.getOpinion(), o.getDecision(), o.getCreatedAt()))
                .toList();
        List<DocDetailResponse.Circulation> circulations = circulationRepository
                .findByDocumentIdOrderByIdAsc(id).stream()
                .map(c -> new DocDetailResponse.Circulation(c.getId(), c.getReaderId(), c.getReaderName(),
                        c.getStatus(), c.getReadAt(), c.getOpinion(), c.getCreatedAt()))
                .toList();

        return new DocDetailResponse(
                d.getId(), d.getDirection(), d.getCode(), d.getTitle(), d.getDocType(), d.getIssuingOrg(),
                d.getSecret(), d.getSecretExpire(), d.getUrgency(), d.getStatus(), d.getUnit(),
                d.getMainRecipients(), d.getCcRecipients(), d.getCopyNo(), d.getIssuer(), d.getAnnotation(),
                d.getDrafter(), d.getSigner(), d.getContent(), d.getDocDate(), d.getSealStatus(),
                d.getSealedBy(), d.getSealedAt(), d.getArchived(), d.getArchiveNo(), d.getTemplateId(),
                d.getDeptId(), deptName, d.getProcessInstanceId(), d.getCreatedAt(),
                currentTask, highlight, timeline, circulations);
    }

    /**
     * 流程图高亮（节点 id 原值，与 designerJson/BPMN 元素 id 对齐）：
     * completed=已结束活动(endTime!=null)；active=未结束活动 + 当前运行时执行的 activityId。
     * 实例已办结（无运行时）时 active 空、completed 覆盖全程。与 workflow 侧实例详情算法一致。
     */
    private DocDetailResponse.Highlight computeHighlight(String pid) {
        Set<String> completed = new LinkedHashSet<>();
        Set<String> active = new LinkedHashSet<>();
        try {
            for (HistoricActivityInstance a : historyService.createHistoricActivityInstanceQuery()
                    .processInstanceId(pid).list()) {
                if (a.getActivityId() == null) {
                    continue;
                }
                if (a.getEndTime() != null) {
                    completed.add(a.getActivityId());
                } else {
                    active.add(a.getActivityId());
                }
            }
            for (Execution ex : runtimeService.createExecutionQuery().processInstanceId(pid).list()) {
                if (ex.getActivityId() != null) {
                    active.add(ex.getActivityId());
                }
            }
        } catch (Exception ignored) {
            // 高亮为尽力而为，失败不影响详情主体
        }
        // 当前活动节点从 completed 移除（多实例/重入场景避免同一节点既亮完成又亮进行）
        completed.removeAll(active);
        return new DocDetailResponse.Highlight(new ArrayList<>(completed), new ArrayList<>(active));
    }

    public PageResult<GongwenListItem> list(String direction, String status, String docType,
                                            String secret, String urgency, String keyword,
                                            LocalDate from, LocalDate to, int pageNum, int pageSize) {
        Specification<Document> cond = (root, query, cb) -> {
            List<Predicate> ps = new ArrayList<>();
            if (StringUtils.hasText(direction)) {
                ps.add(cb.equal(root.get("direction"), direction));
            }
            if (StringUtils.hasText(status)) {
                ps.add(cb.equal(root.get("status"), status));
            }
            if (StringUtils.hasText(docType)) {
                ps.add(cb.equal(root.get("docType"), docType));
            }
            if (StringUtils.hasText(secret)) {
                ps.add(cb.equal(root.get("secret"), secret));
            }
            if (StringUtils.hasText(urgency)) {
                ps.add(cb.equal(root.get("urgency"), urgency));
            }
            if (StringUtils.hasText(keyword)) {
                String like = "%" + keyword.trim() + "%";
                ps.add(cb.or(cb.like(root.get("title"), like), cb.like(root.get("code"), like)));
            }
            if (from != null) {
                ps.add(cb.greaterThanOrEqualTo(root.get("docDate"), from));
            }
            if (to != null) {
                ps.add(cb.lessThanOrEqualTo(root.get("docDate"), to));
            }
            return cb.and(ps.toArray(new Predicate[0]));
        };
        Page<Document> page = documentRepository.findAll(
                cond.and(SecuritySupport.dataScope("deptId", "creatorId")),
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "createdAt")));
        Map<Long, String> deptNames = deptNameResolver.nameMap();
        List<GongwenListItem> list = page.getContent().stream().map(d -> new GongwenListItem(
                d.getId(), d.getDirection(), d.getCode(), d.getTitle(), d.getDocType(), d.getSecret(),
                d.getUrgency(), d.getStatus(), d.getUnit(), d.getDrafter(), d.getSigner(),
                d.getSealStatus(), d.getArchived(), d.getArchiveNo(), d.getDocDate(), d.getDeptId(),
                d.getDeptId() != null ? deptNames.get(d.getDeptId()) : null, d.getCreatedAt())).toList();
        return new PageResult<>(list, page.getTotalElements(), page.getNumber() + 1, page.getSize());
    }

    public PageResult<GongwenListItem> archiveList(String direction, String year, String keyword,
                                                   int pageNum, int pageSize) {
        Specification<Document> cond = (root, query, cb) -> {
            List<Predicate> ps = new ArrayList<>();
            ps.add(cb.isTrue(root.get("archived")));
            if (StringUtils.hasText(direction)) {
                ps.add(cb.equal(root.get("direction"), direction));
            }
            if (StringUtils.hasText(year)) {
                // 年度：卷宗号前缀 {year}- 或成文日期年份
                ps.add(cb.or(
                        cb.like(root.get("archiveNo"), year + "-%"),
                        cb.between(root.get("docDate"),
                                LocalDate.of(Integer.parseInt(year), 1, 1),
                                LocalDate.of(Integer.parseInt(year), 12, 31))));
            }
            if (StringUtils.hasText(keyword)) {
                String like = "%" + keyword.trim() + "%";
                ps.add(cb.or(cb.like(root.get("title"), like), cb.like(root.get("archiveNo"), like),
                        cb.like(root.get("code"), like)));
            }
            return cb.and(ps.toArray(new Predicate[0]));
        };
        Page<Document> page = documentRepository.findAll(
                cond.and(SecuritySupport.dataScope("deptId", "creatorId")),
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "archivedAt")));
        Map<Long, String> deptNames = deptNameResolver.nameMap();
        List<GongwenListItem> list = page.getContent().stream().map(d -> new GongwenListItem(
                d.getId(), d.getDirection(), d.getCode(), d.getTitle(), d.getDocType(), d.getSecret(),
                d.getUrgency(), d.getStatus(), d.getUnit(), d.getDrafter(), d.getSigner(),
                d.getSealStatus(), d.getArchived(), d.getArchiveNo(), d.getDocDate(), d.getDeptId(),
                d.getDeptId() != null ? deptNames.get(d.getDeptId()) : null, d.getCreatedAt())).toList();
        return new PageResult<>(list, page.getTotalElements(), page.getNumber() + 1, page.getSize());
    }

    public PageResult<LedgerResponse> ledger(String year, String keyword, String status,
                                             int pageNum, int pageSize) {
        Specification<DocNumberLedger> cond = (root, query, cb) -> {
            List<Predicate> ps = new ArrayList<>();
            if (StringUtils.hasText(year)) {
                ps.add(cb.like(root.get("docNumber"), "%〔" + year + "〕%"));
            }
            if (StringUtils.hasText(status)) {
                ps.add(cb.equal(root.get("status"), status));
            }
            if (StringUtils.hasText(keyword)) {
                String like = "%" + keyword.trim() + "%";
                ps.add(cb.or(cb.like(root.get("docNumber"), like), cb.like(root.get("docTitle"), like)));
            }
            return cb.and(ps.toArray(new Predicate[0]));
        };
        Page<DocNumberLedger> page = ledgerRepository.findAll(cond,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.ASC, "id")));
        List<LedgerResponse> list = page.getContent().stream().map(l -> new LedgerResponse(
                l.getId(), l.getDocNumber(), l.getRuleId(), l.getDocumentId(), l.getDocTitle(),
                l.getIssuer(), l.getStatus(), l.getIssuedAt())).toList();
        return new PageResult<>(list, page.getTotalElements(), page.getNumber() + 1, page.getSize());
    }

    // ==================== 文号规则 / 模板 / 渲染 ====================

    public List<NumberRuleResponse> numberRules() {
        return docNumberService.enabledRules().stream().map(r -> new NumberRuleResponse(
                r.getId(), r.getCode(), r.getName(), r.getOrgCode(), r.getDocType(), r.getPattern(),
                r.getSeqScope(), r.getSeqWidth(), r.getEnabled(),
                docNumberService.preview(r.getId(), r.getDocType()))).toList();
    }

    public String previewNumber(Long ruleId, String docType) {
        return docNumberService.preview(ruleId, docType);
    }

    public List<TemplateResponse> templates() {
        return templateRepository.findByEnabledTrueOrderByIdAsc().stream().map(this::toTemplateResponse).toList();
    }

    public TemplateResponse template(Long id) {
        return toTemplateResponse(templateRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "模板不存在")));
    }

    public RenderResponse render(Long documentId) {
        Document d = get(documentId);
        DocTemplate tpl = d.getTemplateId() != null
                ? templateRepository.findById(d.getTemplateId()).orElse(null) : null;
        String html = renderer.render(d, tpl);
        boolean upward = d.getDocType() != null && ("请示".equals(d.getDocType()) || "报告".equals(d.getDocType()));
        return new RenderResponse(documentId, tpl != null ? tpl.getId() : null, upward, html);
    }

    // ==================== 内部工具 ====================

    private Document get(Long id) {
        return documentRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "公文不存在"));
    }

    private void requireProcess(Document d) {
        if (!StringUtils.hasText(d.getProcessInstanceId())) {
            throw new BusinessException(400, "该公文未进入办理流程");
        }
    }

    /**
     * 当前活动任务：多实例(会签/多人角色)节点可能有多个并行任务，取最早创建的一个。
     * multiMode=ANY 时办理任一即推进节点，故取首个即可；避免 singleResult 在多任务时抛错。
     */
    private Task activeTask(Document d) {
        List<Task> tasks = taskService.createTaskQuery()
                .processInstanceId(d.getProcessInstanceId()).active()
                .orderByTaskCreateTime().asc().list();
        return tasks.isEmpty() ? null : tasks.get(0);
    }

    private void recordOpinion(Long documentId, String taskKey, UserContext ctx,
                               String opinion, String decision) {
        DocOpinion o = new DocOpinion();
        o.setDocumentId(documentId);
        o.setTaskKey(taskKey);
        o.setUserId(ctx.getUserId());
        o.setUserName(SecuritySupport.displayName(ctx));
        o.setOpinion(opinion);
        o.setDecision(decision);
        opinionRepository.save(o);
    }

    /** 完成节点后按已完成节点 key 推进公文状态。 */
    private void applyStatusAfter(Document d, String completedKey) {
        switch (completedKey) {
            case "review", "countersign" -> d.setStatus(Document.STATUS_REVIEWING);
            case "issue" -> d.setStatus(Document.STATUS_ISSUED);
            case "publish" -> d.setStatus(Document.STATUS_PUBLISHED);
            case "propose" -> d.setStatus(Document.STATUS_APPROVING);
            case "approve" -> d.setStatus(Document.STATUS_HANDLING);
            case "handle" -> {
                Boolean needCirc = readBool(d.getProcessInstanceId(), "needCirculate");
                d.setStatus(Boolean.TRUE.equals(needCirc)
                        ? Document.STATUS_CIRCULATING : Document.STATUS_HANDLING);
            }
            case "finish" -> d.setStatus(Document.STATUS_FINISHED);
            default -> {
            }
        }
    }

    private String permForTask(String key) {
        return switch (key) {
            case "review", "countersign" -> "office:doc:review";
            case "issue", "publish" -> "office:doc:issue";
            default -> "office:doc:assign";
        };
    }

    private void requirePerm(String code) {
        List<String> perms = SecuritySupport.currentUser().getPermissions();
        if (perms != null && !perms.contains(code)) {
            throw new BusinessException(403, "缺少权限：" + code);
        }
    }

    private Long readLong(String pid, String var) {
        Object v = safeVar(pid, var);
        return v instanceof Number n ? n.longValue() : null;
    }

    private Boolean readBool(String pid, String var) {
        Object v = safeVar(pid, var);
        return v instanceof Boolean b ? b : null;
    }

    private Long parseLong(String s) {
        if (!StringUtils.hasText(s)) {
            return null;
        }
        try {
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** best-effort 催办通知：直接写 wf_notify（不引入 workflow 模块实体），失败静默。 */
    private void notifyBestEffort(Long userId, String title, String content, String procInstId) {
        try {
            entityManager.createNativeQuery(
                            "INSERT INTO wf_notify (user_id, type, title, content, proc_inst_id, read_flag, created_at) "
                                    + "VALUES (:uid, 'TODO', :title, :content, :pid, false, now())")
                    .setParameter("uid", userId)
                    .setParameter("title", title)
                    .setParameter("content", content)
                    .setParameter("pid", procInstId)
                    .executeUpdate();
        } catch (Exception ignored) {
            // wf_notify 不可用时不阻断催办
        }
    }

    private Object safeVar(String pid, String var) {
        try {
            return runtimeService.getVariable(pid, var);
        } catch (Exception e) {
            return null;
        }
    }

    private Long defaultTemplateId() {
        return templateRepository.findByEnabledTrueOrderByIdAsc().stream()
                .findFirst().map(DocTemplate::getId).orElse(null);
    }

    private TemplateResponse toTemplateResponse(DocTemplate t) {
        return new TemplateResponse(t.getId(), t.getCode(), t.getName(), t.getType(),
                t.getIssuingOrg(), t.getContent(), t.getSealImageId(), t.getEnabled());
    }
}
