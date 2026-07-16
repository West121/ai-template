package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.boot.ai.service.AiActionService;
import com.xingchen.oa.boot.ai.support.AiSessionHolder;
import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.AssetContent;
import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.AssetNode;
import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.SaveRequest;
import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.SaveResponse;
import com.xingchen.oa.boot.devstudio.entity.DevAssetVersion;
import com.xingchen.oa.boot.devstudio.service.DevStudioService;
import com.xingchen.oa.common.exception.BusinessException;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 开发者工作台 AI 三工具（dev-studio.md 批W2 / §2.1）：
 * <ol>
 *   <li>{@code dev_list_assets} / {@code dev_read_asset}（READ_ONLY，dev:studio:view）——模型定位/读取热资产；</li>
 *   <li>{@code dev_propose_change}（CONFIRM_REQUIRED，dev:studio:edit）——<b>只产 devDiff 提案卡，绝不直写</b>：
 *       服务端读当前内容作 oldContent、当前快照版本作 baseVersion（TOCTOU 基准），
 *       propose 阶段先干跑校验 newContent（坏内容直接 error 卡，不产必败确认）+ 资产写码预检，
 *       再 {@link AiActionService#stage} 动作草稿。</li>
 * </ol>
 * 确认执行（注册执行器）：调 {@link DevStudioService#save}（actor=AI）——双门/干跑/乐观锁全复用；
 * 快照版本冲突（资产在确认前被人改过）→ 409 明确提示重新发起，不静默覆盖。
 */
@Component
@RequiredArgsConstructor
public class DevStudioTools {

    /** 树/列表卡最多行数（结果最小化）。 */
    private static final int LIST_LIMIT = 50;
    /** 给模型的 content 截断阈值（完整内容在 propose 阶段由服务端读取，不依赖模型回传旧文）。 */
    private static final int CONTENT_LIMIT = 6000;

    private final AiToolSupport support;
    private final DevStudioService devStudioService;
    private final AiActionService actionService;
    private final AiSessionHolder sessionHolder;

    @PostConstruct
    public void registerExecutors() {
        // 确认执行（确认请求线程，UserContext=确认者 → 双门/乐观锁/干跑全在 DevStudioService.save 内生效）
        actionService.registerExecutor("dev_propose_change", params -> {
            String type = String.valueOf(params.get("assetType"));
            String code = String.valueOf(params.get("code"));
            String newContent = String.valueOf(params.get("newContent"));
            Integer baseVersion = params.get("baseVersion") instanceof Number n ? n.intValue() : null;
            boolean publish = Boolean.TRUE.equals(params.get("publish"))
                    || "true".equalsIgnoreCase(String.valueOf(params.get("publish")));
            String summary = params.get("summary") == null ? "AI 变更" : String.valueOf(params.get("summary"));
            try {
                SaveResponse r = devStudioService.save(type, code,
                        new SaveRequest(newContent, baseVersion, publish, summary), DevAssetVersion.ACTOR_AI);
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("assetType", type);
                out.put("code", code);
                out.put("version", r.version());
                out.put("published", publish);
                out.put("meta", r.meta());
                return out;
            } catch (BusinessException be) {
                if (be.getCode() == 409) {
                    // 乐观锁 stale：提案基线已被他人（或本人经门面）改过 → 明确失败，请重新读取再发起
                    throw new BusinessException(409, "资产已被修改（当前版本比提案基线新），本提案作废；请重新读取资产后再发起改写");
                }
                throw be;
            }
        });
    }

    // ==================== dev_list_assets ====================

    @AiToolDefinition(name = "dev_list_assets",
            authorities = {"dev:studio:view"},
            description = "【开发者工作台】列出平台可编辑的热资产清单（type 四类：ORCH=自动化编排、PROCESS=流程定义、"
                    + "FORM=在线表单、BIZDOC_TPL=打印模板）。参数 type 可选（四类之一，缺省全部）、keyword 可选（名称/编码模糊）。"
                    + "修改资产前先用本工具确认资产的准确 type 与 code。",
            paramsSchema = "{\"type\":{\"type\":\"string\",\"description\":\"ORCH|PROCESS|FORM|BIZDOC_TPL，可选\"},"
                    + "\"keyword\":{\"type\":\"string\",\"description\":\"名称/编码过滤，可选\"}}")
    public ToolResult listAssets(Map<String, Object> args) {
        String type = upper(str(args.get("type")));
        String keyword = str(args.get("keyword"));
        List<AssetNode> all = devStudioService.listAssets();
        List<Map<String, Object>> rows = new ArrayList<>();
        for (AssetNode n : all) {
            if (type != null && !type.equals(n.type())) {
                continue;
            }
            if (keyword != null && !contains(n.name(), keyword) && !contains(n.code(), keyword)) {
                continue;
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("name", n.name());
            row.put("code", n.code());
            row.put("type", n.type());
            row.put("status", n.status());
            row.put("version", n.version());
            rows.add(row);
        }
        int total = rows.size();
        if (rows.size() > LIST_LIMIT) {
            rows = rows.subList(0, LIST_LIMIT);
        }
        List<Map<String, String>> columns = List.of(
                support.col("name", "名称"), support.col("code", "编码"),
                support.col("type", "类型"), support.col("status", "状态"), support.col("version", "版本"));
        Map<String, Object> card = support.listCard("平台热资产", columns, rows, null);
        return ToolResult.of(support.toJson(Map.of("total", total, "assets", rows)), card);
    }

    // ==================== dev_read_asset ====================

    @AiToolDefinition(name = "dev_read_asset",
            authorities = {"dev:studio:view"}, timeoutSeconds = 20,
            description = "【开发者工作台】读取某热资产的当前内容与版本。修改任何资产前【必须】先调用本工具获取最新 content 与 version，"
                    + "在其基础上改，不要凭记忆或旧内容。参数 assetType（ORCH|PROCESS|FORM|BIZDOC_TPL）、code=资产编码。",
            paramsSchema = "{\"assetType\":{\"type\":\"string\",\"description\":\"ORCH|PROCESS|FORM|BIZDOC_TPL\"},"
                    + "\"code\":{\"type\":\"string\",\"description\":\"资产编码，如 leave_approval\"}}",
            required = {"assetType", "code"})
    public ToolResult readAsset(Map<String, Object> args) {
        String type = upper(str(args.get("assetType")));
        String code = str(args.get("code"));
        AssetContent ac = devStudioService.read(type, code); // 不存在 → 404 转 error 数据帧
        String content = ac.content() == null ? "" : ac.content();
        boolean truncated = content.length() > CONTENT_LIMIT;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("assetType", ac.type());
        out.put("code", ac.code());
        out.put("name", ac.meta() != null ? ac.meta().get("name") : null);
        out.put("status", ac.meta() != null ? ac.meta().get("status") : null);
        out.put("version", ac.version());
        out.put("nativeVersion", ac.meta() != null ? ac.meta().get("nativeVersion") : null);
        if (truncated) {
            out.put("contentTruncated", true);
            out.put("note", "content 过长已截断展示；dev_propose_change 时服务端会按最新完整内容做 diff 基线");
        }
        out.put("content", truncated ? content.substring(0, CONTENT_LIMIT) : content);
        return ToolResult.of(support.toJson(out));
    }

    // ==================== dev_propose_change ====================

    @AiToolDefinition(name = "dev_propose_change",
            authorities = {"dev:studio:edit"}, risk = AiToolRisk.CONFIRM_REQUIRED, timeoutSeconds = 30,
            description = "【开发者工作台】对热资产提交修改提案：产出 diff 确认卡（改动前后对比），用户确认后才落库。"
                    + "【重要】调用前必须先 dev_read_asset 取最新内容；newContent 必须是修改后的【完整内容】"
                    + "（完整 JSON 文本，非差量补丁，未改的部分原样保留）。"
                    + "参数 assetType（ORCH|PROCESS|FORM|BIZDOC_TPL）、code、newContent、summary=一句话变更摘要、"
                    + "publish 可选（true=确认后直接发布生效；缺省 false 仅存草稿，推荐）。",
            paramsSchema = "{\"assetType\":{\"type\":\"string\",\"description\":\"ORCH|PROCESS|FORM|BIZDOC_TPL\"},"
                    + "\"code\":{\"type\":\"string\",\"description\":\"资产编码\"},"
                    + "\"newContent\":{\"type\":\"string\",\"description\":\"修改后的完整内容（完整 JSON 文本，非补丁）\"},"
                    + "\"summary\":{\"type\":\"string\",\"description\":\"一句话变更摘要，如『审批天数阈值 3 → 5』\"},"
                    + "\"publish\":{\"type\":\"boolean\",\"description\":\"确认后是否直接发布生效，缺省 false 仅存草稿\"}}",
            required = {"assetType", "code", "newContent", "summary"})
    public ToolResult proposeChange(Map<String, Object> args) {
        String type = upper(str(args.get("assetType")));
        String code = str(args.get("code"));
        String newContent = args.get("newContent") == null ? null : String.valueOf(args.get("newContent"));
        String summary = str(args.get("summary"));
        boolean publish = Boolean.TRUE.equals(args.get("publish"))
                || "true".equalsIgnoreCase(String.valueOf(args.get("publish")));
        if (!StringUtils.hasText(newContent)) {
            return err("AI_TOOL_INVALID_ARGUMENT", "newContent 必填（修改后的完整内容）");
        }
        // 读当前（不存在 → 404 error 帧）：oldContent + 快照版本 = TOCTOU 基线
        AssetContent cur = devStudioService.read(type, code);
        String oldContent = cur.content() == null ? "" : cur.content();
        Integer baseVersion = cur.version();
        Object name = cur.meta() != null ? cur.meta().get("name") : code;
        // 第二道门预检：缺该资产写码 → error 卡（不产必败确认；confirm 时 DevStudioService 仍复验）
        String writeAuthority = devStudioService.writeAuthority(type);
        if (!support.hasPerm(writeAuthority)) {
            return err("AI_TOOL_FORBIDDEN", "缺少该资产写权限「" + writeAuthority + "」，无法修改 " + type + "/" + code);
        }
        // 干跑前置：坏内容直接 error 卡，不出确认卡（别让用户确认一个必败的提案）
        try {
            devStudioService.validateContent(type, code, newContent);
        } catch (BusinessException be) {
            return err("AI_DRAFT_INVALID", "变更内容未通过校验：" + be.getMessage());
        }
        if (newContent.equals(oldContent)) {
            return err("AI_DRAFT_INVALID", "新内容与当前内容完全一致，无需修改");
        }

        Map<String, Object> params = new LinkedHashMap<>();
        params.put("assetType", type);
        params.put("code", code);
        params.put("newContent", newContent);
        params.put("baseVersion", baseVersion);
        params.put("publish", publish);
        params.put("summary", summary);
        AiSessionHolder.Turn turn = sessionHolder.currentTurn();
        String actionId = actionService.stage(turn != null ? turn.sessionId() : null,
                turn != null ? turn.messageId() : null, "dev_propose_change", "DEV_ASSET_CHANGE", params,
                new AiActionService.Target("devAsset", type + "/" + code, String.valueOf(baseVersion), null));

        // devDiff 卡（批W2 契约，前端 buildLineDiff 渲 diff；danger/effectNote 供危险提示）
        Map<String, Object> card = new LinkedHashMap<>();
        card.put("type", "devDiff");
        card.put("actionId", actionId);
        card.put("assetType", type);
        card.put("code", code);
        card.put("name", name);
        card.put("oldContent", oldContent);
        card.put("newContent", newContent);
        card.put("summary", summary);
        card.put("baseVersion", baseVersion);
        card.put("publish", publish);
        card.put("danger", publish);
        card.put("effectNote", effectNote(type, publish));
        return ToolResult.of(support.toJson(Map.of("staged", true, "actionId", actionId,
                "baseVersion", baseVersion, "publish", publish,
                "note", "已生成变更提案卡（diff），用户确认后才会" + (publish ? "保存并发布" : "保存为草稿"))), card);
    }

    /** 生效面说明（危险提示文案，随资产语义）。 */
    private String effectNote(String type, boolean publish) {
        if (!publish) {
            return "确认后仅保存为草稿，不影响运行；需在工作台/设计器发布后才生效";
        }
        return switch (type) {
            case "ORCH" -> "确认后重新编译并发布，新触发立即走新版本（运行中流水不受影响）";
            case "PROCESS" -> "确认后转 BPMN 重新部署，新发起走新版本（运行中实例不受影响）";
            case "FORM" -> "确认后发布新版本并成为 latest（影响流程发起取数）";
            case "BIZDOC_TPL" -> "确认后发布，打印渲染立即使用新版";
            default -> "确认后立即生效";
        };
    }

    // ==================== 内部 ====================

    private ToolResult err(String code, String message) {
        Map<String, Object> card = new LinkedHashMap<>();
        card.put("type", "error");
        card.put("code", code);
        card.put("message", message);
        return ToolResult.of(support.toJson(Map.of("error", code + ": " + message)), card);
    }

    private boolean contains(String haystack, String needle) {
        return haystack != null && haystack.toLowerCase(Locale.ROOT).contains(needle.toLowerCase(Locale.ROOT));
    }

    private String upper(String s) {
        return s == null ? null : s.toUpperCase(Locale.ROOT);
    }

    private String str(Object v) {
        return v == null || !StringUtils.hasText(String.valueOf(v)) ? null : String.valueOf(v).trim();
    }
}
