package com.xingchen.oa.office.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.DocDetail;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.DocItem;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.DocRequest;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.PrintData;
import com.xingchen.oa.office.entity.BizDoc;
import com.xingchen.oa.office.entity.BizDocDef;
import com.xingchen.oa.office.entity.BizDocPrintTpl;
import com.xingchen.oa.office.repository.BizDocRepository;
import com.xingchen.oa.office.support.DeptNameResolver;
import com.xingchen.oa.office.support.SecuritySupport;
import com.xingchen.oa.system.repository.SysUserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.runtime.ProcessInstance;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 单据运行时（BizDoc §3.2）：台账（数据权限 + listConfig filters）/ 创建 / 更新（DRAFT/REJECTED）/
 * 提交状态机（无流程→占号+EFFECTIVE；有流程→占号+起流程 businessKey=BIZDOC:{id}，__wfRegister 一等实例）/
 * 作废（单号台账 VOID 不回收）/ 打印数据（前端渲染）。
 * 流程办结/取消由 workflow 引擎事件监听回写 EFFECTIVE/REJECTED（按 process_instance_id）。
 */
@Service
@RequiredArgsConstructor
public class BizDocService {

    private static final String BIZ_PREFIX = "BIZDOC:";

    private final BizDocRepository docRepository;
    private final BizDocDefService defService;
    private final DocNumberService docNumberService;
    private final DeptNameResolver deptNameResolver;
    private final SysUserRepository userRepository;
    private final RuntimeService runtimeService;
    private final ObjectMapper objectMapper;

    @PersistenceContext
    private EntityManager entityManager;

    // ==================== 台账 ====================

    /**
     * 台账分页：defCode 必带；keyword 匹配 标题/单号；filters={"字段":"值"}（form_data 字段等值/包含匹配，
     * 数据权限 Specification 后内存过滤——单定义数据集为部门体量，权衡实现简单性）。
     */
    public PageResult<DocItem> page(String defCode, String keyword, String status, String filtersJson,
                                    int pageNum, int pageSize) {
        if (!StringUtils.hasText(defCode)) {
            throw new BusinessException(400, "缺少 defCode");
        }
        BizDocDef def = defService.findByKey(defCode);
        Map<String, String> filters = parseFilters(filtersJson);

        Specification<BizDoc> cond = (root, query, cb) -> {
            List<Predicate> ps = new ArrayList<>();
            ps.add(cb.equal(root.get("defCode"), def.getCode()));
            if (StringUtils.hasText(status)) {
                ps.add(cb.equal(root.get("status"), status));
            }
            if (StringUtils.hasText(keyword)) {
                String like = "%" + keyword.trim() + "%";
                ps.add(cb.or(cb.like(root.get("title"), like), cb.like(root.get("docNo"), like)));
            }
            return cb.and(ps.toArray(new Predicate[0]));
        };
        Specification<BizDoc> scoped = cond.and(SecuritySupport.dataScope("deptId", "creatorId"));

        boolean hasFilters = !filters.isEmpty();
        Page<BizDoc> page = docRepository.findAll(scoped, PageRequest.of(
                hasFilters ? 0 : Math.max(pageNum - 1, 0), hasFilters ? 500 : pageSize,
                Sort.by(Sort.Direction.DESC, "id")));
        List<String> columns = listColumns(def);
        List<DocItem> items = page.getContent().stream()
                .filter(d -> matchesFilters(d, filters))
                .map(d -> toItem(d, columns)).toList();
        if (!hasFilters) {
            return new PageResult<>(items, page.getTotalElements(), page.getNumber() + 1, page.getSize());
        }
        int from = Math.min(Math.max(pageNum - 1, 0) * pageSize, items.size());
        int to = Math.min(from + pageSize, items.size());
        return new PageResult<>(items.subList(from, to), items.size(), pageNum, pageSize);
    }

    // ==================== 创建 / 更新 / 详情 ====================

    @Transactional
    public DocDetail create(DocRequest req) {
        BizDocDef def = defService.findByKey(req.defCode());
        if (!BizDocDef.STATUS_PUBLISHED.equals(def.getStatus())) {
            throw new BusinessException(400, "单据定义未发布: " + def.getCode());
        }
        UserContext ctx = SecuritySupport.currentUser();
        BizDoc doc = new BizDoc();
        doc.setDefId(def.getId());
        doc.setDefCode(def.getCode());
        doc.setTitle(StringUtils.hasText(req.title()) ? req.title()
                : def.getName() + "-" + SecuritySupport.displayName(ctx));
        doc.setFormData(req.formData() != null ? req.formData().toString() : "{}");
        doc.setStatus(BizDoc.STATUS_DRAFT);
        doc.setCreatorId(ctx.getUserId());
        doc.setCreatorName(SecuritySupport.displayName(ctx));
        doc.setDeptId(ctx.getActiveDeptId());
        return toDetail(docRepository.save(doc));
    }

    @Transactional
    public DocDetail update(Long id, DocRequest req) {
        BizDoc doc = requireEditable(id);
        if (StringUtils.hasText(req.title())) {
            doc.setTitle(req.title());
        }
        if (req.formData() != null && !req.formData().isNull()) {
            doc.setFormData(req.formData().toString());
        }
        doc.setUpdatedAt(OffsetDateTime.now());
        return toDetail(docRepository.save(doc));
    }

    public DocDetail detail(Long id) {
        return toDetail(find(id));
    }

    // ==================== 提交 / 作废 ====================

    /** 提交：无流程 → 占号(幂等)+EFFECTIVE；有流程 → 占号+起流程(一等实例)+APPROVING。REJECTED 可改后重提。 */
    @Transactional
    public DocDetail submit(Long id) {
        BizDoc doc = requireEditable(id);
        BizDocDef def = defService.find(doc.getDefId());
        UserContext ctx = SecuritySupport.currentUser();

        // 占号（幂等：已有单号跳过；台账 document_id 不占用——见 DocNumberService.allocateExternal）
        if (def.getNumberRuleId() != null && !StringUtils.hasText(doc.getDocNo())) {
            doc.setDocNo(docNumberService.allocateExternal(def.getNumberRuleId(), null,
                    BIZ_PREFIX + doc.getId() + " " + doc.getTitle(), SecuritySupport.displayName(ctx)));
        }
        if (!StringUtils.hasText(def.getWfDefCode())) {
            doc.setStatus(BizDoc.STATUS_EFFECTIVE);
        } else {
            // 重提：旧实例仍在跑则先删（REJECTED 退回场景实例已被引擎删除，此处兜底）
            cancelRunningInstance(doc);
            Map<String, Object> vars = new HashMap<>();
            vars.put("initiatorId", ctx.getUserId());
            vars.put("initiatorDeptId", ctx.getActiveDeptId());
            vars.put("initiatorName", SecuritySupport.displayName(ctx));
            vars.put("__wfRegister", true);
            vars.put("__title", doc.getTitle());
            putScalarFormVars(doc.getFormData(), vars);
            ProcessInstance pi = runtimeService.startProcessInstanceByKey(
                    def.getWfDefCode(), BIZ_PREFIX + doc.getId(), vars);
            runtimeService.setProcessInstanceName(pi.getId(), doc.getTitle());
            doc.setProcessInstanceId(pi.getProcessInstanceId());
            doc.setStatus(BizDoc.STATUS_APPROVING);
        }
        doc.setUpdatedAt(OffsetDateTime.now());
        return toDetail(docRepository.save(doc));
    }

    /** 作废：EFFECTIVE→VOID（本人或流程管理员）；单号台账置 VOID 不回收（同公文口径）。 */
    @Transactional
    public DocDetail voidDoc(Long id) {
        BizDoc doc = find(id);
        if (!BizDoc.STATUS_EFFECTIVE.equals(doc.getStatus())) {
            throw new BusinessException(400, "仅生效单据可作废");
        }
        UserContext ctx = SecuritySupport.currentUser();
        boolean admin = ctx.getPermissions() == null || ctx.getPermissions().contains("wf:instance:admin");
        if (!admin && !ctx.getUserId().equals(doc.getCreatorId())) {
            throw new BusinessException(403, "仅创建人或管理员可作废");
        }
        if (StringUtils.hasText(doc.getDocNo())) {
            try {
                docNumberService.voidNumber(doc.getDocNo());
            } catch (Exception ignored) {
                // 台账无此号（未占号/历史数据）不阻断作废
            }
        }
        doc.setStatus(BizDoc.STATUS_VOID);
        doc.setUpdatedAt(OffsetDateTime.now());
        return toDetail(docRepository.save(doc));
    }

    // ==================== 打印数据（前端渲染） ====================

    public PrintData printData(Long id, Long tplId) {
        BizDoc doc = find(id);
        BizDocDef def = defService.find(doc.getDefId());
        Long useTpl = tplId != null ? tplId : def.getDefaultPrintTplId();
        if (useTpl == null) {
            throw new BusinessException(400, "该单据定义未配置打印模板");
        }
        BizDocPrintTpl tpl = defService.findTpl(useTpl);
        if (!tpl.getDefId().equals(def.getId())) {
            throw new BusinessException(400, "打印模板不属于该单据定义");
        }
        Map<String, Object> data = new LinkedHashMap<>();
        JsonNode form = parse(doc.getFormData());
        Map<String, String> pickers = pickerFieldTypes(def); // user/dept 选人类字段（按 form_schema widget type）
        if (form != null && form.isObject()) {
            form.properties().forEach(e -> {
                String pickerType = pickers.get(e.getKey());
                if (pickerType != null) {
                    // 关联字段解析为 {id,name[,username]}（数组→对象数组），模板经 {{field.name}} 取显示属性；
                    // 另给平铺便利键 {field}_names="张三、李四"。解析失败保留原值不阻断打印。
                    Object resolved = resolvePicker(e.getValue(), pickerType);
                    data.put(e.getKey(), resolved);
                    String names = joinNames(resolved);
                    if (names != null) {
                        data.put(e.getKey() + "_names", names);
                    }
                } else {
                    data.put(e.getKey(),
                            e.getValue().isValueNode() ? e.getValue().asString("") : e.getValue().toString());
                }
            });
        }
        // 系统字段（sysfield/qrcode 插值用）
        data.put("docNo", doc.getDocNo());
        data.put("title", doc.getTitle());
        data.put("creatorName", doc.getCreatorName());
        data.put("deptName", doc.getDeptId() != null ? deptNameResolver.name(doc.getDeptId()) : null);
        data.put("status", doc.getStatus()); // VOID → 前端渲染 45°作废水印（§8 裁定）
        data.put("createdAt", doc.getCreatedAt() == null ? null
                : doc.getCreatedAt().format(DateTimeFormatter.ofPattern("yyyy-MM-dd")));
        // §9.3 审批记录区：绑流程单据从流程实例取办理记录（与已办/时间线同源=wf_operation，按办理顺序）
        data.put("_approvals", approvals(doc.getProcessInstanceId()));
        List<Map<String, String>> fields = defService.formFields(def);
        return new PrintData(defService.toTplResponse(tpl), data, fields);
    }

    /** 办理记录 [{nodeName, assigneeName, opinion, time}]：wf_operation 原生查询（无流程/未办=[]）。 */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> approvals(String processInstanceId) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (!StringUtils.hasText(processInstanceId)) {
            return out;
        }
        try {
            List<Object[]> rows = entityManager.createNativeQuery(
                            "SELECT node_name, actor_name, comment, created_at FROM wf_operation "
                                    + "WHERE proc_inst_id = :pid AND action IN ('APPROVE','REJECT') "
                                    + "ORDER BY created_at ASC")
                    .setParameter("pid", processInstanceId)
                    .getResultList();
            DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
            for (Object[] r : rows) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("nodeName", r[0]);
                item.put("assigneeName", r[1]);
                item.put("opinion", r[2]);
                String time = null;
                if (r[3] instanceof java.time.OffsetDateTime odt) {
                    time = odt.format(fmt);
                } else if (r[3] instanceof java.sql.Timestamp ts) {
                    time = ts.toLocalDateTime().format(fmt);
                } else if (r[3] instanceof java.time.Instant ins) {
                    time = java.time.LocalDateTime.ofInstant(ins, java.time.ZoneId.systemDefault()).format(fmt);
                } else if (r[3] != null) {
                    time = String.valueOf(r[3]);
                }
                item.put("time", time);
                out.add(item);
            }
        } catch (Exception ignored) {
            // 审批记录尽力而为，失败不阻断打印
        }
        return out;
    }

    // ==================== 选人类字段解析（打印数据） ====================

    /** 定义私有 form_schema 中 user/dept 类字段：key → type（无 schema/解析失败 → 空）。 */
    private Map<String, String> pickerFieldTypes(BizDocDef def) {
        Map<String, String> out = new LinkedHashMap<>();
        if (!StringUtils.hasText(def.getFormSchema())) {
            return out;
        }
        try {
            collectPickerTypes(objectMapper.readTree(def.getFormSchema()), out);
        } catch (Exception ignored) {
            // schema 非法按无选人字段
        }
        return out;
    }

    private void collectPickerTypes(JsonNode node, Map<String, String> out) {
        if (node == null) {
            return;
        }
        if (node.isObject()) {
            String key = node.path("key").asString(null);
            String type = node.path("type").asString(null);
            if (StringUtils.hasText(key) && ("user".equals(type) || "dept".equals(type))) {
                out.put(key, type);
            }
            node.properties().forEach(e -> collectPickerTypes(e.getValue(), out));
        } else if (node.isArray()) {
            node.forEach(n -> collectPickerTypes(n, out));
        }
    }

    /** 解析存储值（id / OrgRef 对象 / 数组）为 {id,name[,username]}；失败保留原值。 */
    private Object resolvePicker(JsonNode value, String type) {
        try {
            if (value == null || value.isNull() || value.isMissingNode()) {
                return null;
            }
            if (value.isArray()) {
                List<Object> list = new ArrayList<>();
                value.forEach(v -> list.add(resolveOne(v, type)));
                return list;
            }
            return resolveOne(value, type);
        } catch (Exception e) {
            return value.isValueNode() ? value.asString("") : value.toString();
        }
    }

    private Object resolveOne(JsonNode v, String type) {
        Long id = null;
        String fallbackName = null;
        if (v.isNumber()) {
            id = v.asLong();
        } else if (v.isTextual()) {
            try {
                id = Long.parseLong(v.asString("").trim());
            } catch (NumberFormatException e) {
                return v.asString(""); // 非 id 文本原样保留
            }
        } else if (v.isObject()) {
            id = v.path("id").isNumber() || v.path("id").isTextual() ? v.path("id").asLong(0) : null;
            fallbackName = v.path("name").asString(null);
        }
        if (id == null || id <= 0) {
            return v.isValueNode() ? v.asString("") : v.toString();
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id);
        if ("dept".equals(type)) {
            String name = deptNameResolver.name(id);
            out.put("name", name != null ? name : fallbackName);
            return out;
        }
        var user = userRepository.findById(id).orElse(null);
        if (user != null) {
            out.put("name", StringUtils.hasText(user.getName()) ? user.getName() : user.getUsername());
            out.put("username", user.getUsername());
        } else {
            out.put("name", fallbackName);
        }
        return out;
    }

    /** 便利键 {field}_names：单值取 name；数组 join「、」。无可用名 → null（不加键）。 */
    @SuppressWarnings("unchecked")
    private String joinNames(Object resolved) {
        if (resolved instanceof Map<?, ?> m) {
            Object n = m.get("name");
            return n != null ? String.valueOf(n) : null;
        }
        if (resolved instanceof List<?> list) {
            List<String> names = new ArrayList<>();
            for (Object o : list) {
                if (o instanceof Map<?, ?> m && m.get("name") != null) {
                    names.add(String.valueOf(m.get("name")));
                }
            }
            return names.isEmpty() ? null : String.join("、", names);
        }
        return null;
    }

    // ==================== 内部 ====================

    private BizDoc find(Long id) {
        return docRepository.findById(id).orElseThrow(() -> new BusinessException(404, "单据不存在"));
    }

    private BizDoc requireEditable(Long id) {
        BizDoc doc = find(id);
        if (!BizDoc.STATUS_DRAFT.equals(doc.getStatus()) && !BizDoc.STATUS_REJECTED.equals(doc.getStatus())) {
            throw new BusinessException(400, "仅草稿/已驳回单据可编辑或提交");
        }
        UserContext ctx = SecuritySupport.currentUser();
        if (!ctx.getUserId().equals(doc.getCreatorId())) {
            throw new BusinessException(403, "仅创建人可编辑该单据");
        }
        return doc;
    }

    private void cancelRunningInstance(BizDoc doc) {
        if (!StringUtils.hasText(doc.getProcessInstanceId())) {
            return;
        }
        try {
            if (runtimeService.createProcessInstanceQuery()
                    .processInstanceId(doc.getProcessInstanceId()).count() > 0) {
                runtimeService.deleteProcessInstance(doc.getProcessInstanceId(), "单据重提");
            }
        } catch (Exception ignored) {
            // 旧实例清理失败不阻断重提
        }
    }

    /** 表单标量值 → 流程变量（审批流条件/取人可用，如 days>3）。 */
    private void putScalarFormVars(String formDataJson, Map<String, Object> vars) {
        JsonNode form = parse(formDataJson);
        if (form == null || !form.isObject()) {
            return;
        }
        form.properties().forEach(e -> {
            JsonNode v = e.getValue();
            if (v.isNumber()) {
                vars.put(e.getKey(), v.asDouble() % 1 == 0 ? v.asLong() : v.asDouble());
            } else if (v.isBoolean()) {
                vars.put(e.getKey(), v.asBoolean());
            } else if (v.isValueNode()) {
                vars.put(e.getKey(), v.asString(""));
            }
        });
    }

    private Map<String, String> parseFilters(String filtersJson) {
        Map<String, String> out = new LinkedHashMap<>();
        if (!StringUtils.hasText(filtersJson)) {
            return out;
        }
        try {
            JsonNode node = objectMapper.readTree(filtersJson);
            node.properties().forEach(e -> {
                String v = e.getValue().asString("");
                if (StringUtils.hasText(v)) {
                    out.put(e.getKey(), v);
                }
            });
        } catch (Exception e) {
            throw new BusinessException(400, "filters JSON 非法");
        }
        return out;
    }

    private boolean matchesFilters(BizDoc doc, Map<String, String> filters) {
        if (filters.isEmpty()) {
            return true;
        }
        JsonNode form = parse(doc.getFormData());
        for (Map.Entry<String, String> f : filters.entrySet()) {
            String actual = form == null ? "" : form.path(f.getKey()).asString("");
            if (!actual.equals(f.getValue()) && !actual.contains(f.getValue())) {
                return false;
            }
        }
        return true;
    }

    private List<String> listColumns(BizDocDef def) {
        List<String> cols = new ArrayList<>();
        JsonNode cfg = parse(def.getListConfig());
        if (cfg != null) {
            cfg.path("columns").forEach(c -> {
                String field = c.path("field").asString("");
                if (StringUtils.hasText(field)) {
                    cols.add(field);
                }
            });
        }
        return cols;
    }

    private DocItem toItem(BizDoc d, List<String> columns) {
        Map<String, Object> fields = new LinkedHashMap<>();
        JsonNode form = parse(d.getFormData());
        for (String col : columns) {
            JsonNode v = form == null ? null : form.path(col);
            fields.put(col, v == null || v.isMissingNode() ? null
                    : (v.isValueNode() ? v.asString("") : v.toString()));
        }
        return new DocItem(d.getId(), d.getDefCode(), d.getDocNo(), d.getTitle(), d.getStatus(),
                d.getCreatorName(), d.getDeptId(),
                d.getDeptId() != null ? deptNameResolver.name(d.getDeptId()) : null,
                d.getProcessInstanceId(), fields, d.getCreatedAt(), d.getUpdatedAt());
    }

    private DocDetail toDetail(BizDoc d) {
        return new DocDetail(d.getId(), d.getDefId(), d.getDefCode(), d.getDocNo(), d.getTitle(),
                d.getStatus(), parse(d.getFormData()), d.getProcessInstanceId(),
                d.getCreatorId(), d.getCreatorName(), d.getDeptId(),
                d.getDeptId() != null ? deptNameResolver.name(d.getDeptId()) : null,
                d.getCreatedAt(), d.getUpdatedAt());
    }

    private JsonNode parse(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }
}
