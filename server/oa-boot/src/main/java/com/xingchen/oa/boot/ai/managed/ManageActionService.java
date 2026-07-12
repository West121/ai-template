package com.xingchen.oa.boot.ai.managed;

import com.xingchen.oa.boot.ai.service.AiActionService;
import com.xingchen.oa.boot.ai.support.AiSessionHolder;
import com.xingchen.oa.boot.ai.tool.AiToolSupport;
import com.xingchen.oa.common.ai.AiManagedAction;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 受控管理操作服务（AI 助手·受控管理操作框架，docs/design/ai-managed-actions.md §2）。
 *
 * <p>支撑三个通用能力（工具 {@code ManageTools} 与 REST {@code AiManageController} 共用同一逻辑）：
 * <ol>
 *   <li><b>list</b>：列出当前用户<b>有权</b>的管理操作（requiredAuthority ⊆ 权限，红线：无权不暴露）；</li>
 *   <li><b>prepare</b>：产表单卡（formSchema + 预填；UPDATE 按 targetId 用 updateLoader 载现值）；</li>
 *   <li><b>submit</b>：表单卡提交 → 复用批A 动作草稿二段式，暂存草稿并产确认卡
 *       （确认走 {@code POST /api/ai/actions/{id}/confirm} → {@link AiManagedGateway} 反射执行）。</li>
 * </ol>
 * 前端复用度：表单卡（{@code type:"manage_form"}，与 workflow 的 form 卡同构，仅 submit 走 /api/ai/manage/submit）、
 * 确认卡（{@code type:"confirm"} 与批A 完全一致，走同一确认端点/组件）。
 */
@Service
@RequiredArgsConstructor
public class ManageActionService {

    /** 表单卡提交端点（前端 manage_form 卡提交到此，换回确认卡）。 */
    public static final String SUBMIT_PATH = "/api/ai/manage/submit";

    private final AiManagedActionRegistry registry;
    private final AiActionService actionService;
    private final AiSessionHolder sessionHolder;
    private final AiToolSupport support;
    private final AiManagedGateway gateway;

    // ==================== list ====================

    /** 当前用户有权的管理操作摘要（前端提示面板 / 工具 llm 内容）。 */
    public List<Map<String, Object>> listActions(String keyword, String module) {
        UserContext user = support.currentUser();
        List<Map<String, Object>> out = new ArrayList<>();
        for (AiManagedAction a : registry.listAuthorized(user, keyword, module)) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("actionCode", a.getActionCode());
            row.put("module", a.getModule());
            row.put("entityLabel", a.getEntityLabel());
            row.put("action", a.getAction().name());
            row.put("label", a.getLabel());
            out.add(row);
        }
        return out;
    }

    /** list 卡（§3 六类卡之 list）：列名固定「操作/实体/编码」，行 link 唤起表单卡由前端处理。 */
    public Map<String, Object> listCard(String keyword, String module) {
        List<Map<String, Object>> actions = listActions(keyword, module);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> a : actions) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("label", a.get("label"));
            row.put("entityLabel", a.get("entityLabel"));
            row.put("actionCode", a.get("actionCode"));
            rows.add(row);
        }
        List<Map<String, String>> columns = List.of(
                support.col("label", "操作"),
                support.col("entityLabel", "实体"),
                support.col("actionCode", "编码"));
        Map<String, Object> card = support.listCard("我可以帮你做的管理操作", columns, rows, null);
        card.put("manageActions", actions); // 前端点击唤起表单卡用（携原始 actionCode/action）
        return card;
    }

    // ==================== prepare（表单卡） ====================

    /**
     * 产表单卡。无权 → 403（红线）；未注册 → 404。UPDATE 缺 targetId → 400。
     * CREATE 用 knownValues 预填（仅保留 schema 内字段）；UPDATE 用 updateLoader 载现值再叠加 knownValues。
     */
    public Map<String, Object> prepareCard(String actionCode, Object knownValues, String targetId) {
        AiManagedActionRegistry.ResolvedAction resolved = requireAuthorized(actionCode);
        AiManagedAction a = resolved.action();

        Map<String, Object> prefill = new LinkedHashMap<>();
        if (a.isUpdate()) {
            if (targetId == null || targetId.isBlank()) {
                throw new BusinessException(400, "编辑「" + a.getEntityLabel() + "」需要指定目标 id");
            }
            if (a.getUpdateLoader() != null) {
                Map<String, Object> current = a.getUpdateLoader().apply(targetId);
                if (current != null) {
                    prefill.putAll(sanitize(current, a));
                }
            }
        }
        prefill.putAll(sanitize(knownValues, a)); // knownValues 覆盖现值

        Map<String, Object> card = new LinkedHashMap<>();
        card.put("type", "manage_form");
        card.put("actionCode", a.getActionCode());
        card.put("action", a.getAction().name());
        card.put("module", a.getModule());
        card.put("entityLabel", a.getEntityLabel());
        card.put("title", a.getLabel());
        card.put("schema", a.schemaWidgets());
        if (!prefill.isEmpty()) {
            card.put("prefill", prefill);
        }
        if (targetId != null && !targetId.isBlank()) {
            card.put("targetId", targetId);
        }
        card.put("submitPath", SUBMIT_PATH);
        return card;
    }

    // ==================== submit（动作草稿二段式 → 确认卡） ====================

    /**
     * 表单卡提交：暂存动作草稿（PENDING_CONFIRM）+ 产确认卡。无权 → 403（二次校验）；未注册 → 404。
     * 执行在确认端点 {@code POST /api/ai/actions/{id}/confirm} 走 {@link AiManagedGateway}。
     */
    public Map<String, Object> submit(String actionCode, Map<String, Object> values, String targetId) {
        AiManagedActionRegistry.ResolvedAction resolved = requireAuthorized(actionCode);
        AiManagedAction a = resolved.action();
        if (a.isUpdate() && (targetId == null || targetId.isBlank())) {
            throw new BusinessException(400, "编辑「" + a.getEntityLabel() + "」需要指定目标 id");
        }
        Map<String, Object> safeValues = sanitize(values, a);
        Map<String, Object> params = gateway.summarizeParams(a, safeValues, targetId);

        AiSessionHolder.Turn turn = sessionHolder.currentTurn();
        String actionId = actionService.stage(
                turn != null ? turn.sessionId() : null,
                turn != null ? turn.messageId() : null,
                AiManagedGateway.EXECUTOR, a.getLabel(), params, null);

        Map<String, Object> card = new LinkedHashMap<>();
        card.put("type", "confirm");
        card.put("actionId", actionId);
        card.put("title", a.getLabel());
        card.put("summary", summarize(a, safeValues, targetId));
        card.put("params", displayParams(a, safeValues, targetId));
        card.put("danger", false);
        return card;
    }

    // ==================== 内部 ====================

    private AiManagedActionRegistry.ResolvedAction requireAuthorized(String actionCode) {
        AiManagedActionRegistry.ResolvedAction resolved = registry.get(actionCode);
        if (resolved == null) {
            throw new BusinessException(404, "未注册的管理操作: " + actionCode);
        }
        UserContext user = support.currentUser();
        if (!registry.hasAuthority(user, resolved.action().getRequiredAuthority())) {
            throw new BusinessException(403, "当前身份缺少权限「"
                    + resolved.action().getRequiredAuthority() + "」，无法" + resolved.action().getLabel());
        }
        return resolved;
    }

    /** 字段限 schema：仅保留 schema 内真实存在的 widget key（防注入任意字段），空值丢弃。 */
    private Map<String, Object> sanitize(Object raw, AiManagedAction a) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (!(raw instanceof Map<?, ?> map) || map.isEmpty()) {
            return out;
        }
        java.util.Set<String> keys = new java.util.HashSet<>();
        for (Map<String, Object> w : a.schemaWidgets()) {
            Object k = w.get("key");
            if (k != null) {
                keys.add(String.valueOf(k));
            }
        }
        for (Map.Entry<?, ?> e : map.entrySet()) {
            String key = String.valueOf(e.getKey());
            if (keys.contains(key) && e.getValue() != null && !String.valueOf(e.getValue()).isBlank()) {
                out.put(key, e.getValue());
            }
        }
        return out;
    }

    private String summarize(AiManagedAction a, Map<String, Object> values, String targetId) {
        StringBuilder sb = new StringBuilder(a.getLabel());
        if (a.isUpdate() && targetId != null) {
            sb.append("（#").append(targetId).append("）");
        }
        Object primary = firstNonBlank(values, "name", "username", "title", "code");
        if (primary != null) {
            sb.append("：").append(primary);
        }
        return sb.toString();
    }

    /** 确认卡 params：schema label + 值（密码字段脱敏），供 ConfirmCard 明细网格展示。 */
    private List<Map<String, Object>> displayParams(AiManagedAction a, Map<String, Object> values, String targetId) {
        List<Map<String, Object>> params = new ArrayList<>();
        if (a.isUpdate() && targetId != null) {
            params.add(Map.of("label", "目标 id", "value", targetId));
        }
        for (Map<String, Object> w : a.schemaWidgets()) {
            String key = String.valueOf(w.get("key"));
            if (!values.containsKey(key)) {
                continue;
            }
            String label = w.get("label") != null ? String.valueOf(w.get("label")) : key;
            Object value = isSecret(key) ? "******" : values.get(key);
            params.add(Map.of("label", label, "value", String.valueOf(value)));
        }
        return params;
    }

    private boolean isSecret(String key) {
        String k = key.toLowerCase();
        return k.contains("password") || k.equals("pwd");
    }

    private Object firstNonBlank(Map<String, Object> values, String... keys) {
        for (String k : keys) {
            Object v = values.get(k);
            if (v != null && !String.valueOf(v).isBlank()) {
                return v;
            }
        }
        return null;
    }
}
