package com.xingchen.oa.office.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.PrintData;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.TplFieldGroup;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.TplFields;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.TplRequest;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.TplResponse;
import com.xingchen.oa.office.entity.BizDocDef;
import com.xingchen.oa.office.entity.BizDocPrintTpl;
import com.xingchen.oa.office.repository.BizDocPrintTplRepository;
import com.xingchen.oa.office.support.DeptNameResolver;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import org.flowable.engine.HistoryService;
import org.flowable.variable.api.history.HistoricVariableInstance;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 独立文档模板（bizdoc-design.md §11，/api/bizdoc/tpls）：模板绑定到流程(FLOW=wf defCode)或
 * 表单(FORM=formCode)，在 wf 流程实例上渲染打印；与业务单据（BIZDOC 绑定，原 defs/{id}/print-tpls 路径）并存。
 * wf 数据经原生查询（office 不依赖 workflow 业务模块，同 BizDocDefService 口径）。
 */
@Service
@RequiredArgsConstructor
public class BizDocTplService {

    private static final Pattern CODE_PATTERN = Pattern.compile("[a-zA-Z][a-zA-Z0-9_-]{1,63}");
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    /** 审批记录伪字段组（编辑器字段树 _approvals 子字段，与 print data _approvals 元素同名）。 */
    private static final List<Map<String, String>> APPROVAL_FIELDS = List.of(
            Map.of("key", "nodeName", "label", "节点名称"),
            Map.of("key", "assigneeName", "label", "办理人"),
            Map.of("key", "opinion", "label", "办理意见"),
            Map.of("key", "time", "label", "办理时间"));

    private final BizDocPrintTplRepository tplRepository;
    private final BizDocDefService defService;
    private final BizDocService docService;
    private final BizDocCalcService calcService;
    private final DeptNameResolver deptNameResolver;
    private final HistoryService historyService;
    private final ObjectMapper objectMapper;

    @PersistenceContext
    private EntityManager entityManager;

    // ==================== CRUD / 发布 ====================

    public PageResult<TplResponse> page(String keyword, String category, String bindType,
                                        int pageNum, int pageSize) {
        Specification<BizDocPrintTpl> spec = (root, query, cb) -> {
            List<Predicate> ps = new ArrayList<>();
            if (StringUtils.hasText(keyword)) {
                String like = "%" + keyword.trim() + "%";
                ps.add(cb.or(cb.like(root.get("name"), like), cb.like(root.get("code"), like)));
            }
            if (StringUtils.hasText(category)) {
                ps.add(cb.equal(root.get("category"), category));
            }
            if (StringUtils.hasText(bindType)) {
                ps.add(cb.equal(root.get("bindType"), bindType));
            }
            return cb.and(ps.toArray(new Predicate[0]));
        };
        Page<BizDocPrintTpl> page = tplRepository.findAll(spec, PageRequest.of(
                Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        // 列表不回传 content（元素树大 JSON），详情/render-data 取全量
        List<TplResponse> list = page.getContent().stream().map(t -> toResponse(t, false)).toList();
        return new PageResult<>(list, page.getTotalElements(), page.getNumber() + 1, page.getSize());
    }

    public TplResponse detail(Long id) {
        return toResponse(find(id), true);
    }

    @Transactional
    public TplResponse create(TplRequest req) {
        if (!StringUtils.hasText(req.name())) {
            throw new BusinessException(400, "模板名称必填");
        }
        BizDocPrintTpl tpl = new BizDocPrintTpl();
        applyBind(tpl, req);
        if (StringUtils.hasText(req.code())) {
            if (!CODE_PATTERN.matcher(req.code()).matches()) {
                throw new BusinessException(400, "模板编码非法（字母开头，字母数字-_，≤64）");
            }
            if (tplRepository.findByCode(req.code()).isPresent()) {
                throw new BusinessException(400, "模板编码已存在: " + req.code());
            }
            tpl.setCode(req.code());
        } else {
            tpl.setCode(defService.genTplCode());
        }
        tpl.setStatus(BizDocPrintTpl.STATUS_DRAFT);
        tpl.setVersion(0); // 首次发布 → v1
        tpl.setIsDefault(false);
        apply(tpl, req);
        return toResponse(tplRepository.save(tpl), true);
    }

    @Transactional
    public TplResponse update(Long id, TplRequest req) {
        BizDocPrintTpl tpl = requireIndependent(id);
        if (StringUtils.hasText(req.bindType()) || StringUtils.hasText(req.bindCode())) {
            applyBind(tpl, new TplRequest(null, null,
                    StringUtils.hasText(req.bindType()) ? req.bindType() : tpl.getBindType(),
                    StringUtils.hasText(req.bindCode()) ? req.bindCode() : tpl.getBindCode(),
                    null, null, null, null, null));
        }
        apply(tpl, req); // code 不可改（唯一标识）
        tpl.setUpdatedAt(OffsetDateTime.now());
        return toResponse(tplRepository.save(tpl), true);
    }

    @Transactional
    public void delete(Long id) {
        defService.deleteTpl(id); // BIZDOC 附属含默认模板解绑；独立模板直删
    }

    /** 发布：status→PUBLISHED，version+1（§11 发布自增）。 */
    @Transactional
    public TplResponse publish(Long id) {
        BizDocPrintTpl tpl = find(id);
        tpl.setStatus(BizDocPrintTpl.STATUS_PUBLISHED);
        tpl.setVersion(tpl.getVersion() == null ? 1 : tpl.getVersion() + 1);
        tpl.setUpdatedAt(OffsetDateTime.now());
        return toResponse(tplRepository.save(tpl), true);
    }

    // ==================== 字段树 / 渲染数据 / 实例匹配 ====================

    /** 编辑器字段树：FLOW=流程绑定表单统一清单+_approvals 伪字段组；FORM=统一清单；BIZDOC=定义清单（绑流程时含 _approvals）。 */
    public TplFields fields(Long id) {
        BizDocPrintTpl tpl = find(id);
        List<Map<String, String>> fields;
        boolean withApprovals;
        switch (tpl.getBindType()) {
            case BizDocPrintTpl.BIND_FLOW -> {
                fields = defService.formFieldsByFormCode(processFormCode(tpl.getBindCode()));
                withApprovals = true;
            }
            case BizDocPrintTpl.BIND_FORM -> {
                fields = defService.formFieldsByFormCode(tpl.getBindCode());
                withApprovals = false;
            }
            default -> { // BIZDOC 原路径
                BizDocDef def = defService.find(tpl.getDefId());
                fields = defService.formFields(def);
                withApprovals = StringUtils.hasText(def.getWfDefCode());
            }
        }
        List<TplFieldGroup> groups = withApprovals
                ? List.of(new TplFieldGroup("_approvals", "审批记录", APPROVAL_FIELDS))
                : List.of();
        return new TplFields(tpl.getBindType(), tpl.getBindCode(), fields, groups);
    }

    /**
     * 渲染数据（FLOW/FORM 绑定）：wf 实例 formData（选人类字段解析同 docs/{id}/print 口径）
     * + _approvals + 系统字段（title/creatorName/deptName/status/createdAt；单号无 → docNo=null）。
     * 校验实例 defCode/formCode 与模板绑定匹配；权限=实例可见性（同 /api/wf/instances/{id}：登录即可查）。
     * BIZDOC 绑定沿用 GET /api/bizdoc/docs/{id}/print。
     */
    public PrintData renderData(Long id, String instanceId) {
        BizDocPrintTpl tpl = find(id);
        if (BizDocPrintTpl.BIND_BIZDOC.equals(tpl.getBindType())) {
            throw new BusinessException(400, "BIZDOC 绑定模板请使用 GET /api/bizdoc/docs/{id}/print");
        }
        WfInstanceRow inst = findInstance(instanceId);
        if (BizDocPrintTpl.BIND_FLOW.equals(tpl.getBindType()) && !inst.defCode().equals(tpl.getBindCode())) {
            throw new BusinessException(400, "实例流程(" + inst.defCode() + ")与模板绑定(" + tpl.getBindCode() + ")不匹配");
        }
        if (BizDocPrintTpl.BIND_FORM.equals(tpl.getBindType()) && !tpl.getBindCode().equals(inst.formCode())) {
            throw new BusinessException(400, "实例表单(" + inst.formCode() + ")与模板绑定(" + tpl.getBindCode() + ")不匹配");
        }
        // 引擎直起实例（BizDoc/公文，__wfRegister 注册）无 form_data_json → 历史变量兜底（best-effort）
        String formDataJson = StringUtils.hasText(inst.formDataJson())
                ? inst.formDataJson() : historicVarsJson(inst.procInstId());
        Map<String, Object> data = docService.renderFormData(formDataJson, inst.formSchemaSnapshot());
        data.put("docNo", null); // §11 系统字段：单号无
        data.put("title", inst.title());
        data.put("creatorName", inst.initiatorName()); // 渲染器 sysfield 键与 BIZDOC print 对齐
        data.put("initiatorName", inst.initiatorName());
        data.put("deptName", inst.initiatorDeptId() != null ? deptNameResolver.name(inst.initiatorDeptId()) : null);
        data.put("status", inst.bizStatus());
        data.put("createdAt", inst.createdAt() != null ? inst.createdAt().format(DATE_FMT) : null);
        data.put("_approvals", docService.approvalRecords(inst.procInstId()));
        // §12 计算配置：模板 calc 段（聚合+公式）求值并入 data（优先级最低，不踩表单/系统字段）
        calcService.apply(tpl.getContent(), formDataJson, data);
        String formCode = StringUtils.hasText(inst.formCode()) ? inst.formCode()
                : (BizDocPrintTpl.BIND_FORM.equals(tpl.getBindType()) ? tpl.getBindCode()
                : processFormCode(tpl.getBindCode()));
        return new PrintData(defService.toTplResponse(tpl), data, defService.formFieldsByFormCode(formCode));
    }

    /** 实例可打印模板列表：已发布 且 (FLOW 绑实例 defCode 或 FORM 绑实例 formCode)。 */
    public List<TplResponse> forInstance(String instanceId) {
        WfInstanceRow inst = findInstance(instanceId);
        List<BizDocPrintTpl> hits = new ArrayList<>(tplRepository
                .findByBindTypeAndBindCodeAndStatusOrderByIdAsc(
                        BizDocPrintTpl.BIND_FLOW, inst.defCode(), BizDocPrintTpl.STATUS_PUBLISHED));
        if (StringUtils.hasText(inst.formCode())) {
            hits.addAll(tplRepository.findByBindTypeAndBindCodeAndStatusOrderByIdAsc(
                    BizDocPrintTpl.BIND_FORM, inst.formCode(), BizDocPrintTpl.STATUS_PUBLISHED));
        }
        return hits.stream().map(t -> toResponse(t, false)).toList();
    }

    // ==================== 内部 ====================

    private BizDocPrintTpl find(Long id) {
        return tplRepository.findById(id).orElseThrow(() -> new BusinessException(404, "模板不存在"));
    }

    private BizDocPrintTpl requireIndependent(Long id) {
        BizDocPrintTpl tpl = find(id);
        if (BizDocPrintTpl.BIND_BIZDOC.equals(tpl.getBindType())) {
            throw new BusinessException(400, "BIZDOC 绑定模板经 /api/bizdoc/defs/{defId}/print-tpls 管理");
        }
        return tpl;
    }

    /** 绑定校验（§11.2 新建校验 bind_code 存在）：FLOW→wf_process_ext 已发布；FORM→wf_form_def 存在。 */
    private void applyBind(BizDocPrintTpl tpl, TplRequest req) {
        String bindType = req.bindType() == null ? "" : req.bindType().toUpperCase();
        String bindCode = req.bindCode();
        if (!BizDocPrintTpl.BIND_FLOW.equals(bindType) && !BizDocPrintTpl.BIND_FORM.equals(bindType)) {
            throw new BusinessException(400, "bindType 须为 FLOW/FORM（BIZDOC 模板经 /api/bizdoc/defs/{defId}/print-tpls 管理）");
        }
        if (!StringUtils.hasText(bindCode)) {
            throw new BusinessException(400, "bindCode 必填（FLOW=流程 defCode / FORM=表单 code）");
        }
        if (BizDocPrintTpl.BIND_FLOW.equals(bindType)) {
            Number n = (Number) entityManager.createNativeQuery(
                            "SELECT count(*) FROM wf_process_ext WHERE def_code = :code AND status = 'PUBLISHED'")
                    .setParameter("code", bindCode).getSingleResult();
            if (n.longValue() == 0) {
                throw new BusinessException(400, "流程未发布或不存在: " + bindCode);
            }
        } else {
            Number n = (Number) entityManager.createNativeQuery(
                            "SELECT count(*) FROM wf_form_def WHERE code = :code")
                    .setParameter("code", bindCode).getSingleResult();
            if (n.longValue() == 0) {
                throw new BusinessException(400, "表单不存在: " + bindCode);
            }
        }
        tpl.setBindType(bindType);
        tpl.setBindCode(bindCode);
        tpl.setDefId(null);
    }

    private void apply(BizDocPrintTpl tpl, TplRequest req) {
        if (StringUtils.hasText(req.name())) {
            tpl.setName(req.name());
        }
        if (req.category() != null) {
            tpl.setCategory(StringUtils.hasText(req.category()) ? req.category() : null);
        }
        if (req.description() != null) {
            tpl.setDescription(StringUtils.hasText(req.description()) ? req.description() : null);
        }
        if (StringUtils.hasText(req.paper())) {
            tpl.setPaper(req.paper());
        }
        if (req.landscape() != null) {
            tpl.setLandscape(req.landscape());
        }
        if (req.content() != null && !req.content().isNull()) {
            tpl.setContent(req.content().toString());
        }
    }

    /** FLOW 绑定流程的表单 code（最新 ext 行）。 */
    private String processFormCode(String defCode) {
        List<?> rows = entityManager.createNativeQuery(
                        "SELECT form_code FROM wf_process_ext WHERE def_code = :code")
                .setParameter("code", defCode).getResultList();
        return rows.isEmpty() || rows.get(0) == null ? null : String.valueOf(rows.get(0));
    }

    /** wf 实例（wf_instance_ext）：instanceId 纯数字=ext id，否则=procInstId（同 /api/wf/instances/{id} 口径）。 */
    private WfInstanceRow findInstance(String instanceId) {
        if (!StringUtils.hasText(instanceId)) {
            throw new BusinessException(400, "缺少 instanceId");
        }
        String where = instanceId.matches("\\d+") ? "id = :v" : "proc_inst_id = :v";
        List<?> rows = entityManager.createNativeQuery(
                        "SELECT proc_inst_id, def_code, title, initiator_name, initiator_dept_id, "
                                + "form_code, form_schema_snapshot, form_data_json, biz_status, created_at "
                                + "FROM wf_instance_ext WHERE " + where)
                .setParameter("v", instanceId.matches("\\d+") ? Long.valueOf(instanceId) : instanceId)
                .getResultList();
        if (rows.isEmpty()) {
            throw new BusinessException(404, "流程实例不存在: " + instanceId);
        }
        Object[] r = (Object[]) rows.get(0);
        return new WfInstanceRow(str(r[0]), str(r[1]), str(r[2]), str(r[3]),
                r[4] == null ? null : ((Number) r[4]).longValue(),
                str(r[5]), str(r[6]), str(r[7]), str(r[8]), toOffset(r[9]));
    }

    /** 历史流程变量 → 表单数据 JSON（跳过 __* 内部变量与发起人上下文；标量值 best-effort，失败=空）。 */
    private String historicVarsJson(String procInstId) {
        try {
            Map<String, Object> out = new LinkedHashMap<>();
            for (HistoricVariableInstance v : historyService.createHistoricVariableInstanceQuery()
                    .processInstanceId(procInstId).list()) {
                String name = v.getVariableName();
                Object val = v.getValue();
                if (name == null || name.startsWith("__") || name.startsWith("initiator")
                        || !(val instanceof String || val instanceof Number || val instanceof Boolean)) {
                    continue;
                }
                // 整数归一：起流程时标量三目(asLong:asDouble)数值提升会把 2 存成 2.0，打印显示按 2
                if (val instanceof Number n && !(val instanceof Long || val instanceof Integer)
                        && n.doubleValue() % 1 == 0) {
                    val = n.longValue();
                }
                out.put(name, val);
            }
            return objectMapper.writeValueAsString(out);
        } catch (Exception e) {
            return "{}";
        }
    }

    private TplResponse toResponse(BizDocPrintTpl t, boolean withContent) {
        return new TplResponse(t.getId(), t.getCode(), t.getName(), t.getBindType(), t.getBindCode(),
                t.getDefId(), t.getCategory(), t.getDescription(), t.getPaper(), t.getLandscape(),
                withContent ? parse(t.getContent()) : null,
                t.getStatus(), t.getVersion(), t.getIsDefault(), t.getCreatedAt(), t.getUpdatedAt());
    }

    private tools.jackson.databind.JsonNode parse(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static OffsetDateTime toOffset(Object o) {
        if (o instanceof OffsetDateTime odt) {
            return odt;
        }
        if (o instanceof java.sql.Timestamp ts) {
            return ts.toInstant().atZone(java.time.ZoneId.systemDefault()).toOffsetDateTime();
        }
        if (o instanceof java.time.Instant ins) {
            return ins.atZone(java.time.ZoneId.systemDefault()).toOffsetDateTime();
        }
        return null;
    }

    /** wf_instance_ext 投影行。 */
    private record WfInstanceRow(String procInstId, String defCode, String title, String initiatorName,
                                 Long initiatorDeptId, String formCode, String formSchemaSnapshot,
                                 String formDataJson, String bizStatus, OffsetDateTime createdAt) {
    }
}
