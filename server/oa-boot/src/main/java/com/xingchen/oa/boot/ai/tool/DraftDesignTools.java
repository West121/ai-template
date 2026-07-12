package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.boot.ai.service.AiActionService;
import com.xingchen.oa.boot.ai.service.AiInlineLlm;
import com.xingchen.oa.boot.ai.support.AiSessionHolder;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.TplRequest;
import com.xingchen.oa.office.dto.bizdoc.BizDocDtos.TplResponse;
import com.xingchen.oa.office.service.BizDocTplService;
import com.xingchen.oa.workflow.dto.FormDefRequest;
import com.xingchen.oa.workflow.dto.FormDefResponse;
import com.xingchen.oa.workflow.service.FormDefService;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 亮点⑧「对话生成模板/表单草稿」（批E，附3）：自然语言 → 单据打印模板（BdTemplateV2）/ 在线表单
 * （widgets）草稿卡 → 进设计器继续编辑，<b>永不直接发布</b>。
 *
 * <p>模型只产结构化草稿（{@link AiInlineLlm#structured}，BeanOutputConverter + 块/控件类型强校验，
 * 非法回 error 卡不落库）。风险级 {@link AiToolRisk#EXPLICIT_UI_SUBMIT}——确认经动作草稿二段式，
 * 落 DRAFT 模板/表单定义（复用 {@link BizDocTplService#create} / {@link FormDefService#create}，
 * 二者建即 DRAFT/未发布）。
 *
 * <p><b>Part 契约（给疾风）</b>：
 * {@code templateDraft{draftId,name,blocks:[{type,label}]}} /
 * {@code formDraft{draftId,name,fields:[{label,type}]}}——draftId=动作草稿 id。
 * 确认响应：模板 {@code {tplId, designerPath:"/bizdoc/tpl/t/{id}"}}；表单 {@code {formId, designerPath:"/workflow/form-defs"}}。
 */
@Component
@RequiredArgsConstructor
public class DraftDesignTools {

    /** BdTemplateV2 合法块类型（bizdoc-design.md §9.1）。 */
    private static final Set<String> BLOCK_TYPES = Set.of("title", "docInfo", "infoTable", "labelField",
            "text", "detailTable", "approvalTable", "row", "signature", "qrcode", "barcode", "image",
            "divider", "spacer");

    /** 在线表单合法控件类型（form-renderer 已支持叶子）。 */
    private static final Set<String> WIDGET_TYPES = Set.of("input", "textarea", "number", "date",
            "select", "radio", "checkbox", "user", "rating");

    private final AiToolSupport support;
    private final AiInlineLlm inlineLlm;
    private final AiActionService actionService;
    private final AiSessionHolder sessionHolder;
    private final BizDocTplService bizDocTplService;
    private final FormDefService formDefService;
    private final ObjectMapper objectMapper;

    /** NL→BdTemplateV2 草稿结构。 */
    public record BdTemplateDraftSpec(String title, List<BdBlockSpec> blocks) {
    }

    public record BdBlockSpec(String type, String label, String text) {
    }

    /** NL→表单 widgets 草稿结构。 */
    public record FormSchemaDraftSpec(String name, List<FormWidgetSpec> widgets) {
    }

    public record FormWidgetSpec(String type, String label, String key) {
    }

    @PostConstruct
    public void registerExecutors() {
        actionService.registerExecutor("bizdoc_prepare_template", params -> {
            ObjectNode content = parse(String.valueOf(params.get("content")));
            TplResponse resp = bizDocTplService.create(new TplRequest(
                    null, String.valueOf(params.get("name")),
                    String.valueOf(params.get("bindType")), String.valueOf(params.get("bindCode")),
                    null, null, null, null, content));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("tplId", resp.id());
            out.put("code", resp.code());
            out.put("status", resp.status());
            out.put("designerPath", "/bizdoc/tpl/t/" + resp.id());
            return out;
        });
        actionService.registerExecutor("form_prepare_schema", params -> {
            FormDefResponse resp = formDefService.create(new FormDefRequest(
                    String.valueOf(params.get("code")), String.valueOf(params.get("name")),
                    String.valueOf(params.get("schemaJson")), "AI 草稿"));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("formId", resp.id());
            out.put("code", resp.code());
            out.put("status", resp.status());
            out.put("designerPath", "/workflow/form-defs");
            return out;
        });
    }

    // ==================== ⑧-1 单据打印模板 ====================

    @AiToolDefinition(name = "bizdoc_prepare_template",
            authorities = {"bizdoc:def:write"}, risk = AiToolRisk.EXPLICIT_UI_SUBMIT, timeoutSeconds = 30,
            description = "根据自然语言生成一个单据打印模板草稿（标题+信息块+审批区等），产草稿卡，"
                    + "用户确认后建为草稿模板（不发布），再进模板设计器编辑。参数 desc=模板描述，"
                    + "bindType=FLOW(绑流程 defCode)|FORM(绑表单 code)，bindCode=对应编码，name 可选。",
            paramsSchema = "{\"desc\":{\"type\":\"string\",\"description\":\"模板描述，如『车辆申请单打印模板，含申请信息表和审批区』\"},"
                    + "\"bindType\":{\"type\":\"string\",\"description\":\"FLOW 或 FORM\"},"
                    + "\"bindCode\":{\"type\":\"string\",\"description\":\"绑定的流程 defCode 或表单 code\"},"
                    + "\"name\":{\"type\":\"string\",\"description\":\"模板名称，可选\"}}",
            required = {"desc", "bindType", "bindCode"})
    public ToolResult prepareTemplate(Map<String, Object> args) {
        String desc = str(args.get("desc"));
        String bindType = str(args.get("bindType"));
        String bindCode = str(args.get("bindCode"));
        if (!StringUtils.hasText(bindType) || !StringUtils.hasText(bindCode)) {
            return err("AI_TOOL_INVALID_ARGUMENT", "生成模板需指定绑定对象（bindType=FLOW/FORM 与 bindCode）");
        }
        BdTemplateDraftSpec spec = inlineLlm.structured(BdTemplateDraftSpec.class,
                "你是单据打印模板设计器。blocks 每项 type 取 title/infoTable/labelField/text/detailTable/"
                        + "approvalTable/signature/divider/spacer 等，label 为一句话。只输出 JSON。",
                "根据以下描述生成单据打印模板草稿：" + desc);
        if (spec == null) {
            return err("AI_DRAFT_UNAVAILABLE", "未能理解模板描述（模型不可用或描述过于笼统）");
        }
        if (spec.blocks() == null || spec.blocks().isEmpty()) {
            return err("AI_DRAFT_INVALID", "模板草稿缺少内容块");
        }
        ObjectNode content = objectMapper.createObjectNode();
        content.put("schemaVersion", 2);
        ObjectNode page = content.putObject("page");
        page.put("size", "A4").put("landscape", false).put("fontFamily", "宋体");
        page.putArray("margin").add(20).add(20).add(20).add(20);
        ArrayNode blockArr = content.putArray("blocks");
        List<Map<String, Object>> cardBlocks = new ArrayList<>();
        int i = 0;
        for (BdBlockSpec b : spec.blocks()) {
            String type = b == null ? null : str(b.type());
            String label = b == null ? "" : (str(b.label()) == null ? "" : str(b.label()));
            if (type == null || !BLOCK_TYPES.contains(type)) {
                return err("AI_DRAFT_INVALID", "不支持的模板块类型：" + type);
            }
            blockArr.add(buildBlock("b" + (++i), type, label, b == null ? null : str(b.text())));
            Map<String, Object> cb = new LinkedHashMap<>();
            cb.put("type", type);
            cb.put("label", label);
            cardBlocks.add(cb);
        }
        String name = StringUtils.hasText(str(spec.title())) ? str(spec.title())
                : (StringUtils.hasText(str(args.get("name"))) ? str(args.get("name")) : "单据模板草稿");

        Map<String, Object> params = new LinkedHashMap<>();
        params.put("name", name);
        params.put("bindType", bindType.toUpperCase());
        params.put("bindCode", bindCode);
        params.put("content", content.toString());
        String draftId = stage("bizdoc_prepare_template", "BIZDOC_TPL_CREATE", params);

        Map<String, Object> card = new LinkedHashMap<>();
        card.put("type", "templateDraft");
        card.put("draftId", draftId);
        card.put("name", name);
        card.put("blocks", cardBlocks);
        return ToolResult.of(support.toJson(Map.of("staged", true, "draftId", draftId, "name", name,
                "blockCount", cardBlocks.size(), "note", "已生成单据模板草稿卡，确认后建为草稿模板（不发布）")), card);
    }

    private ObjectNode buildBlock(String id, String type, String label, String text) {
        ObjectNode n = objectMapper.createObjectNode();
        n.put("id", id).put("type", type);
        switch (type) {
            case "title" -> {
                n.put("text", StringUtils.hasText(label) ? label : "标题");
                n.putObject("style").put("fontSize", 18).put("bold", true).put("align", "center");
            }
            case "labelField" -> n.put("label", label).put("value", "");
            case "text" -> n.put("content", StringUtils.hasText(text) ? text : label);
            case "infoTable" -> {
                n.put("columnsPerRow", 2);
                n.putArray("cells");
            }
            case "detailTable" -> {
                n.put("field", "items");
                n.putArray("columns");
            }
            case "approvalTable" -> n.putArray("steps");
            case "docInfo" -> n.putArray("items");
            case "row" -> n.putArray("children");
            case "signature" -> n.put("label", StringUtils.hasText(label) ? label : "签章").put("align", "right");
            case "spacer" -> n.put("h", 6);
            case "qrcode", "barcode" -> n.put("value", "{{docNo}}");
            default -> { /* divider/image：无必填 */ }
        }
        return n;
    }

    // ==================== ⑧-2 在线表单 ====================

    @AiToolDefinition(name = "form_prepare_schema",
            authorities = {"wf:def:edit"}, risk = AiToolRisk.EXPLICIT_UI_SUBMIT, timeoutSeconds = 30,
            description = "根据自然语言生成一个在线表单草稿（字段控件），产草稿卡，用户确认后建为草稿表单定义"
                    + "（不发布），再进表单设计器编辑。参数 desc=表单描述，name 可选。",
            paramsSchema = "{\"desc\":{\"type\":\"string\",\"description\":\"表单描述，如『报销单：报销人、金额、事由、附件』\"},"
                    + "\"name\":{\"type\":\"string\",\"description\":\"表单名称，可选\"}}",
            required = {"desc"})
    public ToolResult prepareForm(Map<String, Object> args) {
        String desc = str(args.get("desc"));
        if (!StringUtils.hasText(desc)) {
            return err("AI_TOOL_INVALID_ARGUMENT", "请描述你想要的表单字段");
        }
        FormSchemaDraftSpec spec = inlineLlm.structured(FormSchemaDraftSpec.class,
                "你是在线表单设计器。widgets 每项 type 取 input/textarea/number/date/select/radio/checkbox/user，"
                        + "label 为字段名，key 为英文字段键（可留空由系统生成）。只输出 JSON。",
                "根据以下描述生成表单字段草稿：" + desc);
        if (spec == null) {
            return err("AI_DRAFT_UNAVAILABLE", "未能理解表单描述（模型不可用或描述过于笼统）");
        }
        if (spec.widgets() == null || spec.widgets().isEmpty()) {
            return err("AI_DRAFT_INVALID", "表单草稿缺少字段");
        }
        ObjectNode schema = objectMapper.createObjectNode();
        ArrayNode widgetArr = schema.putArray("widgets");
        List<Map<String, Object>> cardFields = new ArrayList<>();
        int i = 0;
        for (FormWidgetSpec w : spec.widgets()) {
            String type = w == null ? null : str(w.type());
            String label = w == null ? "" : (str(w.label()) == null ? "" : str(w.label()));
            if (type == null || !WIDGET_TYPES.contains(type)) {
                return err("AI_DRAFT_INVALID", "不支持的表单控件类型：" + type);
            }
            String key = w == null ? null : str(w.key());
            ObjectNode widget = widgetArr.addObject();
            widget.put("key", StringUtils.hasText(key) ? key : "field" + (i + 1));
            widget.put("label", label);
            widget.put("type", type);
            widget.put("required", false);
            i++;
            Map<String, Object> cf = new LinkedHashMap<>();
            cf.put("label", label);
            cf.put("type", type);
            cardFields.add(cf);
        }
        String name = StringUtils.hasText(str(spec.name())) ? str(spec.name())
                : (StringUtils.hasText(str(args.get("name"))) ? str(args.get("name")) : "表单草稿");
        String code = "aiform" + Long.toString(System.currentTimeMillis(), 36)
                + Integer.toString((int) (Math.random() * 1000));

        Map<String, Object> params = new LinkedHashMap<>();
        params.put("code", code);
        params.put("name", name);
        params.put("schemaJson", schema.toString());
        String draftId = stage("form_prepare_schema", "FORM_SCHEMA_CREATE", params);

        Map<String, Object> card = new LinkedHashMap<>();
        card.put("type", "formDraft");
        card.put("draftId", draftId);
        card.put("name", name);
        card.put("fields", cardFields);
        return ToolResult.of(support.toJson(Map.of("staged", true, "draftId", draftId, "name", name,
                "fieldCount", cardFields.size(), "note", "已生成表单草稿卡，确认后建为草稿表单定义（不发布）")), card);
    }

    // ==================== 内部 ====================

    private String stage(String toolName, String actionType, Map<String, Object> params) {
        AiSessionHolder.Turn turn = sessionHolder.currentTurn();
        return actionService.stage(turn != null ? turn.sessionId() : null,
                turn != null ? turn.messageId() : null, toolName, actionType, params, null);
    }

    private ObjectNode parse(String json) {
        try {
            return (ObjectNode) objectMapper.readTree(json);
        } catch (Exception e) {
            return objectMapper.createObjectNode();
        }
    }

    private ToolResult err(String code, String message) {
        Map<String, Object> card = new LinkedHashMap<>();
        card.put("type", "error");
        card.put("code", code);
        card.put("message", message);
        return ToolResult.of(support.toJson(Map.of("error", code + ": " + message)), card);
    }

    private String str(Object v) {
        return v == null || !StringUtils.hasText(String.valueOf(v)) ? null : String.valueOf(v).trim();
    }
}
