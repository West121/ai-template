package com.xingchen.oa.boot.ai.managed;

import com.xingchen.oa.boot.ai.tool.AiToolDefinition;
import com.xingchen.oa.boot.ai.tool.AiToolRisk;
import com.xingchen.oa.boot.ai.tool.AiToolSupport;
import com.xingchen.oa.boot.ai.tool.ToolResult;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Map;

/**
 * 受控管理操作·通用工具（AI 助手·受控管理操作框架，docs/design/ai-managed-actions.md §2）。
 *
 * <p><b>3 个通用工具替代给每个业务写工具</b>：本类含 list/prepare 两个只读工具；提交（submit）是用户在表单卡上的
 * UI 动作，走 REST {@code POST /api/ai/manage/submit}（{@link AiManageController}，不经 LLM），提交后复用批A
 * 动作草稿二段式确认执行。工具本身登录即暴露，具体操作按 requiredAuthority 在服务内过滤（红线：无权不暴露）。
 *
 * <p>可扩展：任何业务只要新增 {@code AiManagedActionProvider} 描述符，这两个工具与提交端点即自动覆盖它，
 * 无需新增工具或改 AI 核心。
 */
@Component
@RequiredArgsConstructor
public class ManageTools {

    private final ManageActionService manageService;
    private final AiToolSupport support;

    @AiToolDefinition(name = "manage_list_actions", risk = AiToolRisk.READ_ONLY,
            description = "列出当前用户【有权限】执行的管理操作（新增/编辑用户、部门、角色、岗位等，只读，不改数据）。"
                    + "当用户想新增/修改组织人事等管理对象、或问「你能帮我做哪些管理操作」时先调用它，再据结果调 manage_prepare。"
                    + "可选 keyword（按名称/编码模糊）、module（如 system）过滤。",
            paramsSchema = "{\"keyword\":{\"type\":\"string\",\"description\":\"按操作名/实体/编码模糊过滤，可选\"},"
                    + "\"module\":{\"type\":\"string\",\"description\":\"按模块过滤，如 system，可选\"}}")
    public ToolResult listActions(Map<String, Object> args) {
        String keyword = str(args, "keyword");
        String module = str(args, "module");
        List<Map<String, Object>> actions = manageService.listActions(keyword, module);
        Map<String, Object> card = manageService.listCard(keyword, module);
        String llm = actions.isEmpty()
                ? "当前身份没有可用的管理操作（无相关功能权限）。"
                : support.toJson(Map.of("count", actions.size(), "actions", actions,
                        "hint", "已在对话中展示可用管理操作，选中后用 manage_prepare 生成表单卡"));
        return ToolResult.of(llm, card);
    }

    @AiToolDefinition(name = "manage_prepare", risk = AiToolRisk.READ_ONLY,
            description = "为选定的管理操作生成对话内表单卡（含字段 schema 与预填值），用户填写后提交即进入确认。"
                    + "actionCode 必须来自 manage_list_actions 返回的编码（如 system.user.create），不可编造。"
                    + "【重要】从用户话语中提取已明确的字段值填入 knownValues 预填（键须是该操作表单字段 key）；"
                    + "编辑类操作（actionCode 以 .update 结尾）必须给 targetId（要编辑的对象 id）。",
            paramsSchema = "{\"actionCode\":{\"type\":\"string\",\"description\":\"操作编码，来自 manage_list_actions\"},"
                    + "\"knownValues\":{\"type\":\"object\",\"description\":\"从用户话语提取的已知字段值，用于预填，键须是表单字段 key，可选\"},"
                    + "\"targetId\":{\"type\":\"string\",\"description\":\"编辑类操作的目标对象 id（.update 操作必填）\"}}",
            required = {"actionCode"})
    public ToolResult prepare(Map<String, Object> args) {
        String actionCode = str(args, "actionCode");
        String targetId = str(args, "targetId");
        Map<String, Object> card = manageService.prepareCard(actionCode, args.get("knownValues"), targetId);
        return ToolResult.of(support.toJson(Map.of("actionCode", actionCode,
                "hint", "已在对话中展示表单卡，请填写后提交（提交后会再出确认卡）")), card);
    }

    private String str(Map<String, Object> args, String key) {
        Object v = args == null ? null : args.get(key);
        return v == null || !StringUtils.hasText(String.valueOf(v)) ? null : String.valueOf(v).trim();
    }
}
