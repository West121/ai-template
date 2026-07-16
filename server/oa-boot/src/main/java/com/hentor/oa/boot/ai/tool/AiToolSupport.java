package com.hentor.oa.boot.ai.tool;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.CurrentUserHolder;
import com.hentor.oa.common.security.UserContext;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * AI 工具公共支撑：当前用户、权限判定、卡片构造（§3 六类 + §10 补充字段）、结果 JSON 序列化。
 */
@Component
public class AiToolSupport {

    private final ObjectMapper objectMapper;

    public AiToolSupport(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public UserContext currentUser() {
        UserContext ctx = CurrentUserHolder.get();
        if (ctx == null) {
            throw new BusinessException(401, "未登录");
        }
        return ctx;
    }

    /** 功能权限判定：permissions==null（离线）视为放行。 */
    public boolean hasPerm(String code) {
        List<String> perms = currentUser().getPermissions();
        return perms == null || perms.contains(code);
    }

    public String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            return String.valueOf(value);
        }
    }

    // ---------- 卡片构造（Map 形式，序列化为 §3 Card） ----------

    public Map<String, Object> navigateCard(String path, String title, String desc) {
        Map<String, Object> c = base("navigate");
        c.put("path", path);
        c.put("title", title);
        if (desc != null) {
            c.put("desc", desc);
        }
        return c;
    }

    /** §10.2 受控导航 V2（批C）：featureCode+routeParams 为主形状；path 兼容期并存（旧前端直接可用）。 */
    public Map<String, Object> navigateCardV2(String featureCode, String path, String title,
                                              String desc, Map<String, Object> routeParams) {
        Map<String, Object> c = navigateCard(path, title, desc);
        c.put("featureCode", featureCode);
        c.put("routeParams", routeParams == null ? Map.of() : routeParams);
        return c;
    }

    /** §10：list 行支持 link（行级跳转 path）；columns=[{key,label}]。 */
    public Map<String, Object> listCard(String title, List<Map<String, String>> columns,
                                        List<Map<String, Object>> rows, String moreLink) {
        Map<String, Object> c = base("list");
        c.put("title", title);
        c.put("columns", columns);
        c.put("rows", rows);
        if (moreLink != null) {
            c.put("moreLink", moreLink);
        }
        return c;
    }

    /** §10：confirm 补 danger（危险操作红色语义）。 */
    public Map<String, Object> confirmCard(String actionId, String title, String summary,
                                           Map<String, Object> params, boolean danger) {
        Map<String, Object> c = base("confirm");
        c.put("actionId", actionId);
        c.put("title", title);
        c.put("summary", summary);
        c.put("params", params);
        c.put("danger", danger);
        return c;
    }

    /** §10：form 补 submitPath(CODE)；schema=在线表单 widgets。无预填时用此重载。 */
    public Map<String, Object> formCard(String defCode, String defName, String formType,
                                        Object schema, String submitPath) {
        return formCard(defCode, defName, formType, schema, submitPath, null);
    }

    /**
     * §8.1 对话式表单：form 补 submitPath(CODE)；schema=在线表单 widgets；prefill=已清洗的预填值
     * {fieldKey:value}（后端从 LLM knownValues 提取并按 schema 校正——前端透传 FormRenderer initialValues，
     * 契约：card.prefill，即 V2 part.payload.prefill）。空/无预填则省略该字段（前端可选读）。
     */
    public Map<String, Object> formCard(String defCode, String defName, String formType,
                                        Object schema, String submitPath, Map<String, Object> prefill) {
        Map<String, Object> c = base("form");
        c.put("defCode", defCode);
        c.put("defName", defName);
        c.put("formType", formType);
        if (schema != null) {
            c.put("schema", schema);
        }
        if (submitPath != null) {
            c.put("submitPath", submitPath);
        }
        if (prefill != null && !prefill.isEmpty()) {
            c.put("prefill", prefill);
        }
        return c;
    }

    /** chart：series=[{name,data}]；pie 数据项 §10 支持 percent（前端据 total 展示）。 */
    public Map<String, Object> chartCard(String chartType, String title,
                                         List<String> categories, List<Map<String, Object>> series) {
        Map<String, Object> c = base("chart");
        c.put("chartType", chartType);
        c.put("title", title);
        if (categories != null) {
            c.put("categories", categories);
        }
        c.put("series", series);
        return c;
    }

    public Map<String, Object> linkCard(List<Map<String, String>> items) {
        Map<String, Object> c = base("link");
        c.put("items", items);
        return c;
    }

    private Map<String, Object> base(String type) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("type", type);
        return c;
    }

    public Map<String, String> col(String key, String label) {
        return Map.of("key", key, "label", label);
    }
}
