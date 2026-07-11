package com.xingchen.oa.office.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.DefRequest;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.DefResponse;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.PrintTplRequest;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.PrintTplResponse;
import com.xingchen.oa.office.entity.BizDocDef;
import com.xingchen.oa.office.entity.BizDocPrintTpl;
import com.xingchen.oa.office.repository.BizDocDefRepository;
import com.xingchen.oa.office.repository.BizDocPrintTplRepository;
import com.xingchen.oa.office.repository.DocNumberRuleRepository;
import com.xingchen.oa.office.support.SecuritySupport;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 单据定义管理（BizDoc §3.1）：CRUD + publish/disable。
 * 发布校验：表单存在（wf_form_def，经原生查询——office 不依赖 workflow 模块）、编号规则存在、
 * wf_def_code 已发布（wf_process_ext）、list_config 字段属于表单字段清单（CODE 取 field_manifest /
 * ONLINE 从 schema_json 递归收 key，best-effort）。
 */
@Service
@RequiredArgsConstructor
public class BizDocDefService {

    private static final Pattern CODE_PATTERN = Pattern.compile("[a-zA-Z][a-zA-Z0-9_-]{1,63}");

    private final BizDocDefRepository defRepository;
    private final BizDocPrintTplRepository tplRepository;
    private final DocNumberRuleRepository numberRuleRepository;
    private final ObjectMapper objectMapper;

    @PersistenceContext
    private EntityManager entityManager;

    // ==================== 定义 CRUD ====================

    public PageResult<DefResponse> page(String keyword, String status, int pageNum, int pageSize) {
        String kw = keyword == null ? "" : keyword;
        Page<BizDocDef> page = defRepository.findByNameContainingOrCodeContaining(kw, kw,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        List<DefResponse> list = page.getContent().stream()
                .filter(d -> !StringUtils.hasText(status) || status.equals(d.getStatus()))
                .map(this::toResponse).toList();
        return new PageResult<>(list, page.getTotalElements(), page.getNumber() + 1, page.getSize());
    }

    public List<DefResponse> published() {
        return defRepository.findByStatusOrderByIdAsc(BizDocDef.STATUS_PUBLISHED)
                .stream().map(this::toResponse).toList();
    }

    public DefResponse get(String key) {
        return toResponse(findByKey(key));
    }

    @Transactional
    public DefResponse create(DefRequest req) {
        if (!StringUtils.hasText(req.code()) || !CODE_PATTERN.matcher(req.code()).matches()) {
            throw new BusinessException(400, "单据编码非法（字母开头，字母数字-_，≤64）");
        }
        if (defRepository.findByCode(req.code()).isPresent()) {
            throw new BusinessException(400, "单据编码已存在: " + req.code());
        }
        BizDocDef def = new BizDocDef();
        def.setCode(req.code());
        UserContext ctx = SecuritySupport.currentUser();
        def.setCreatedBy(ctx.getUserId());
        apply(def, req);
        return toResponse(defRepository.save(def));
    }

    @Transactional
    public DefResponse update(Long id, DefRequest req) {
        BizDocDef def = find(id);
        apply(def, req);
        def.setUpdatedAt(OffsetDateTime.now());
        return toResponse(defRepository.save(def));
    }

    @Transactional
    public void delete(Long id) {
        BizDocDef def = find(id);
        if (BizDocDef.STATUS_PUBLISHED.equals(def.getStatus())) {
            throw new BusinessException(400, "已发布定义不可删除，请先停用");
        }
        tplRepository.findByDefIdOrderByIdAsc(id).forEach(tplRepository::delete);
        defRepository.delete(def);
    }

    /** 发布：绑定项全量校验 → PUBLISHED。 */
    @Transactional
    public DefResponse publish(Long id) {
        BizDocDef def = find(id);
        validateBindings(def);
        def.setStatus(BizDocDef.STATUS_PUBLISHED);
        def.setUpdatedAt(OffsetDateTime.now());
        return toResponse(defRepository.save(def));
    }

    @Transactional
    public DefResponse disable(Long id) {
        BizDocDef def = find(id);
        def.setStatus(BizDocDef.STATUS_DISABLED);
        def.setUpdatedAt(OffsetDateTime.now());
        return toResponse(defRepository.save(def));
    }

    // ==================== 打印模板 ====================

    public List<PrintTplResponse> tpls(Long defId) {
        find(defId);
        return tplRepository.findByDefIdOrderByIdAsc(defId).stream().map(this::toTplResponse).toList();
    }

    @Transactional
    public PrintTplResponse createTpl(Long defId, PrintTplRequest req) {
        BizDocDef def = find(defId);
        BizDocPrintTpl tpl = new BizDocPrintTpl();
        tpl.setDefId(defId);
        tpl.setBindType(BizDocPrintTpl.BIND_BIZDOC);
        tpl.setCode(genTplCode()); // §11 code 唯一；BIZDOC 原路径自动生成（status/version 沿实体默认 PUBLISHED/1，零回归）
        applyTpl(tpl, req);
        boolean first = tplRepository.findByDefIdOrderByIdAsc(defId).isEmpty();
        tpl.setIsDefault(first);
        tpl = tplRepository.save(tpl);
        if (first) {
            def.setDefaultPrintTplId(tpl.getId());
            defRepository.save(def);
        }
        return toTplResponse(tpl);
    }

    @Transactional
    public PrintTplResponse updateTpl(Long tplId, PrintTplRequest req) {
        BizDocPrintTpl tpl = findTpl(tplId);
        applyTpl(tpl, req);
        return toTplResponse(tplRepository.save(tpl));
    }

    @Transactional
    public void deleteTpl(Long tplId) {
        BizDocPrintTpl tpl = findTpl(tplId);
        if (tpl.getDefId() == null) { // §11 独立模板（FLOW/FORM）无定义附属
            tplRepository.delete(tpl);
            return;
        }
        BizDocDef def = find(tpl.getDefId());
        if (tplId.equals(def.getDefaultPrintTplId())) {
            def.setDefaultPrintTplId(null);
            defRepository.save(def);
        }
        tplRepository.delete(tpl);
    }

    @Transactional
    public PrintTplResponse setDefaultTpl(Long tplId) {
        BizDocPrintTpl tpl = findTpl(tplId);
        if (tpl.getDefId() == null) {
            throw new BusinessException(400, "独立模板（FLOW/FORM 绑定）无默认模板概念");
        }
        BizDocDef def = find(tpl.getDefId());
        for (BizDocPrintTpl t : tplRepository.findByDefIdOrderByIdAsc(def.getId())) {
            t.setIsDefault(t.getId().equals(tplId));
            tplRepository.save(t);
        }
        def.setDefaultPrintTplId(tplId);
        defRepository.save(def);
        return toTplResponse(tpl);
    }

    public BizDocPrintTpl findTpl(Long tplId) {
        return tplRepository.findById(tplId)
                .orElseThrow(() -> new BusinessException(404, "打印模板不存在"));
    }

    /** 模板编码自动生成（tpl_ + 8 位 hex，唯一约束兜底）。 */
    public String genTplCode() {
        return "tpl_" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }

    // ==================== 校验 / 字段清单（原生查 wf 表，office 不依赖 workflow 模块） ====================

    /** §10 INLINE 发布校验：form_schema 非空、含至少一个字段、字段 key 全局唯一。 */
    private void validateInlineSchema(BizDocDef def) {
        if (!StringUtils.hasText(def.getFormSchema())) {
            throw new BusinessException(400, "发布失败：INLINE 单据须先完成字段设计（form_schema 为空）");
        }
        List<String> keys = new ArrayList<>();
        try {
            collectKeys(objectMapper.readTree(def.getFormSchema()), keys);
        } catch (Exception e) {
            throw new BusinessException(400, "发布失败：form_schema JSON 非法");
        }
        if (keys.isEmpty()) {
            throw new BusinessException(400, "发布失败：form_schema 未包含任何字段");
        }
        Set<String> seen = new LinkedHashSet<>();
        for (String k : keys) {
            if (!seen.add(k)) {
                throw new BusinessException(400, "发布失败：字段 key 重复: " + k);
            }
        }
    }

    /** 收集 schema 内全部字段 key（不去重，供唯一性校验）。 */
    private void collectKeys(tools.jackson.databind.JsonNode node, List<String> out) {
        if (node == null) {
            return;
        }
        if (node.isObject()) {
            String key = node.path("key").asString(null);
            if (StringUtils.hasText(key)) {
                out.add(key);
            }
            node.properties().forEach(e -> collectKeys(e.getValue(), out));
        } else if (node.isArray()) {
            node.forEach(n -> collectKeys(n, out));
        }
    }

    /**
     * 表单字段清单 [{key,label}]：INLINE 从单据私有 form_schema 派生（§10 主路径）；
     * CODE 取 wf_form_def.field_manifest；存量 ONLINE 兼容读外部 wf 表单 schema。
     */
    public List<Map<String, String>> formFields(BizDocDef def) {
        List<Map<String, String>> out = new ArrayList<>();
        if (BizDocDef.FORM_INLINE.equals(def.getFormType())) {
            try {
                if (StringUtils.hasText(def.getFormSchema())) {
                    collectFields(objectMapper.readTree(def.getFormSchema()), out, new LinkedHashSet<>());
                }
            } catch (Exception ignored) {
                // schema 非法按空
            }
            return out;
        }
        return formFieldsByFormCode(def.getFormCode());
    }

    /** wf 表单统一字段清单 [{key,label}]（CODE=field_manifest / ONLINE=schema 递归；§11 FLOW/FORM 模板复用）。 */
    public List<Map<String, String>> formFieldsByFormCode(String formCode) {
        List<Map<String, String>> out = new ArrayList<>();
        if (!StringUtils.hasText(formCode)) {
            return out;
        }
        List<?> rows = entityManager.createNativeQuery(
                        "SELECT form_type, schema_json, field_manifest FROM wf_form_def "
                                + "WHERE code = :code ORDER BY version DESC LIMIT 1")
                .setParameter("code", formCode)
                .getResultList();
        if (rows.isEmpty()) {
            return out;
        }
        Object[] row = (Object[]) rows.get(0);
        String formType = String.valueOf(row[0]);
        try {
            if ("CODE".equalsIgnoreCase(formType) && row[2] != null) {
                for (JsonNode f : objectMapper.readTree(String.valueOf(row[2]))) {
                    out.add(fieldEntry(f.path("key").asString(""), f.path("label").asString(""),
                            f.path("type").asString(null)));
                }
            } else if (row[1] != null) {
                collectFields(objectMapper.readTree(String.valueOf(row[1])), out, new LinkedHashSet<>());
            }
        } catch (Exception ignored) {
            // 清单解析失败按空（发布校验降级为存在性校验）
        }
        return out;
    }

    /**
     * 递归收 ONLINE schema 里的 {key,label|title[,type]}（容器透明，best-effort）。
     * type 有值时带上——前端计算配置（§12）按 {@code type=subform} 列候选子表（聚合数据源下拉）；
     * subform 本身入清单，其列仍展开为子项（现状保留）。
     */
    private void collectFields(JsonNode node, List<Map<String, String>> out, Set<String> seen) {
        if (node == null) {
            return;
        }
        if (node.isObject()) {
            String key = node.path("key").asString(null);
            if (StringUtils.hasText(key) && seen.add(key)) {
                String label = node.path("label").asString(node.path("title").asString(key));
                out.add(fieldEntry(key, label, node.path("type").asString(null)));
            }
            node.properties().forEach(e -> collectFields(e.getValue(), out, seen));
        } else if (node.isArray()) {
            node.forEach(n -> collectFields(n, out, seen));
        }
    }

    /** 字段清单条目 {key,label[,type]}（type 空则不加键，兼容既有消费方）。 */
    private static Map<String, String> fieldEntry(String key, String label, String type) {
        Map<String, String> f = new LinkedHashMap<>();
        f.put("key", key);
        f.put("label", label);
        if (StringUtils.hasText(type)) {
            f.put("type", type);
        }
        return f;
    }

    private void validateBindings(BizDocDef def) {
        if (BizDocDef.FORM_INLINE.equals(def.getFormType())) {
            validateInlineSchema(def); // §10：INLINE 校验私有 schema 非空 + 字段 key 唯一
        } else {
            if (!StringUtils.hasText(def.getFormCode())) {
                throw new BusinessException(400, "发布失败：未绑定表单");
            }
            Number formCount = (Number) entityManager.createNativeQuery(
                            "SELECT count(*) FROM wf_form_def WHERE code = :code")
                    .setParameter("code", def.getFormCode()).getSingleResult();
            if (formCount.longValue() == 0) {
                throw new BusinessException(400, "发布失败：表单不存在: " + def.getFormCode());
            }
        }
        if (def.getNumberRuleId() != null && numberRuleRepository.findById(def.getNumberRuleId()).isEmpty()) {
            throw new BusinessException(400, "发布失败：编号规则不存在: " + def.getNumberRuleId());
        }
        if (StringUtils.hasText(def.getWfDefCode())) {
            Number wfCount = (Number) entityManager.createNativeQuery(
                            "SELECT count(*) FROM wf_process_ext WHERE def_code = :code AND status = 'PUBLISHED'")
                    .setParameter("code", def.getWfDefCode()).getSingleResult();
            if (wfCount.longValue() == 0) {
                throw new BusinessException(400, "发布失败：审批流未发布或不存在: " + def.getWfDefCode());
            }
        }
        // list_config 字段属于表单清单（清单可得时严格校验）
        if (StringUtils.hasText(def.getListConfig())) {
            try {
                JsonNode cfg = objectMapper.readTree(def.getListConfig());
                Set<String> known = new LinkedHashSet<>();
                formFields(def).forEach(f -> known.add(f.get("key")));
                if (!known.isEmpty()) {
                    for (JsonNode col : cfg.path("columns")) {
                        String field = col.path("field").asString("");
                        if (StringUtils.hasText(field) && !known.contains(field)) {
                            throw new BusinessException(400, "发布失败：台账列字段不在表单清单中: " + field);
                        }
                    }
                    for (JsonNode f : cfg.path("filters")) {
                        String field = f.path("field").asString("");
                        if (StringUtils.hasText(field) && !known.contains(field)) {
                            throw new BusinessException(400, "发布失败：筛选字段不在表单清单中: " + field);
                        }
                    }
                }
            } catch (BusinessException be) {
                throw be;
            } catch (Exception e) {
                throw new BusinessException(400, "发布失败：list_config JSON 非法");
            }
        }
    }

    // ==================== 内部 ====================

    public BizDocDef find(Long id) {
        return defRepository.findById(id).orElseThrow(() -> new BusinessException(404, "单据定义不存在"));
    }

    public BizDocDef findByKey(String key) {
        return key != null && key.matches("\\d+") ? find(Long.valueOf(key))
                : defRepository.findByCode(key)
                .orElseThrow(() -> new BusinessException(404, "单据定义不存在: " + key));
    }

    private void apply(BizDocDef def, DefRequest req) {
        if (StringUtils.hasText(req.name())) {
            def.setName(req.name());
        }
        def.setCategory(req.category());
        def.setIcon(req.icon());
        if (StringUtils.hasText(req.formType())) {
            def.setFormType(req.formType().toUpperCase());
        }
        def.setFormCode(req.formCode());
        def.setSubmitPath(req.submitPath());
        if (req.formSchema() != null && !req.formSchema().isNull()) {
            def.setFormSchema(req.formSchema().toString());
        }
        def.setNumberRuleId(req.numberRuleId());
        def.setWfDefCode(req.wfDefCode());
        if (req.listConfig() != null && !req.listConfig().isNull()) {
            def.setListConfig(req.listConfig().toString());
        }
        def.setRemark(req.remark());
    }

    private void applyTpl(BizDocPrintTpl tpl, PrintTplRequest req) {
        if (StringUtils.hasText(req.name())) {
            tpl.setName(req.name());
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

    public DefResponse toResponse(BizDocDef d) {
        return new DefResponse(d.getId(), d.getCode(), d.getName(), d.getCategory(), d.getIcon(),
                d.getFormType(), d.getFormCode(), d.getSubmitPath(), parse(d.getFormSchema()),
                d.getNumberRuleId(), d.getWfDefCode(), parse(d.getListConfig()),
                d.getDefaultPrintTplId(), d.getStatus(), d.getRemark(), d.getCreatedAt(), d.getUpdatedAt());
    }

    public PrintTplResponse toTplResponse(BizDocPrintTpl t) {
        return new PrintTplResponse(t.getId(), t.getDefId(), t.getName(), t.getPaper(),
                t.getLandscape(), parse(t.getContent()), t.getIsDefault(), t.getCreatedAt());
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
