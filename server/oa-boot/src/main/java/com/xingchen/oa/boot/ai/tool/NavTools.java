package com.xingchen.oa.boot.ai.tool;

import com.xingchen.oa.boot.ai.entity.AiFeatureCatalog;
import com.xingchen.oa.boot.ai.service.AiFeatureService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 导航/功能知识工具（批C 改读 ai_feature_catalog，§12.1）：目录按用户功能权限过滤——
 * 导航只推可见项（安全红线）；navigate 卡 V2 = {featureCode, routeParams, title}（path 兼容并存），
 * featureCode 由服务端可信目录出卡（§10.2 模型不产任意 path）。功能解释带 FEATURE 引用（亮点④）。
 */
@Component
@RequiredArgsConstructor
public class NavTools {

    private static final int MAX_CITATIONS = 8;

    private final AiToolSupport support;
    private final AiFeatureService featureService;

    @AiToolDefinition(name = "feature_get_user_capabilities", aliases = {"list_functions"},
            description = "列出当前用户可见的系统功能菜单及说明，用于介绍系统能力或推荐入口。无参数。")
    public ToolResult listFunctions(Map<String, Object> args) {
        List<AiFeatureCatalog> items = featureService.visibleFor(support.currentUser());
        List<Map<String, Object>> forLlm = new ArrayList<>();
        List<Map<String, String>> links = new ArrayList<>();
        List<Map<String, Object>> citations = new ArrayList<>();
        for (AiFeatureCatalog f : items) {
            forLlm.add(Map.of("featureCode", f.getFeatureCode(), "title", f.getName(),
                    "path", f.getRouteCode(), "desc", nz(f.getDescription())));
            links.add(Map.of("title", f.getName(), "path", f.getRouteCode(),
                    "featureCode", f.getFeatureCode()));
            if (citations.size() < MAX_CITATIONS) {
                citations.add(ToolResult.citation("FEATURE", f.getFeatureCode(), f.getName()));
            }
        }
        return ToolResult.of(support.toJson(Map.of("functions", forLlm)), support.linkCard(links))
                .withCitations(citations);
    }

    @AiToolDefinition(name = "navigation_open", aliases = {"open_function"},
            description = "按名称或用户意图匹配一个功能菜单并给出打开入口。参数 query=功能名或意图关键词。",
            paramsSchema = "{\"query\":{\"type\":\"string\",\"description\":\"功能名或意图，如 请假、发文、我的待办\"}}",
            required = {"query"})
    public ToolResult openFunction(Map<String, Object> args) {
        String query = String.valueOf(args.getOrDefault("query", "")).trim();
        List<AiFeatureCatalog> items = featureService.visibleFor(support.currentUser());
        AiFeatureCatalog hit = items.stream()
                .filter(f -> f.getName().contains(query) || query.contains(f.getName()))
                .findFirst().orElseGet(() -> items.stream()
                        .filter(f -> containsKeyword(f, query) || nz(f.getDescription()).contains(query)
                                || f.getRouteCode().contains(query.toLowerCase()))
                        .findFirst().orElse(null));
        if (hit == null) {
            return ToolResult.of(support.toJson(Map.of("matched", false,
                    "hint", "未匹配到功能，可先用 feature_get_user_capabilities 查看全部可见功能")));
        }
        // §10.2：navigate 卡由服务端目录出卡（featureCode 天然合法+可见）
        return ToolResult.of(support.toJson(Map.of("matched", true, "featureCode", hit.getFeatureCode(),
                        "title", hit.getName(), "path", hit.getRouteCode())),
                        support.navigateCardV2(hit.getFeatureCode(), hit.getRouteCode(),
                                hit.getName(), hit.getDescription(), Map.of()))
                .withCitations(List.of(ToolResult.citation("FEATURE", hit.getFeatureCode(), hit.getName())));
    }

    private boolean containsKeyword(AiFeatureCatalog f, String query) {
        if (!StringUtils.hasText(f.getKeywords()) || !StringUtils.hasText(query)) {
            return false;
        }
        for (String k : f.getKeywords().split(",")) {
            if (StringUtils.hasText(k) && (k.contains(query) || query.contains(k.trim()))) {
                return true;
            }
        }
        return false;
    }

    private String nz(String s) {
        return s == null ? "" : s;
    }
}
