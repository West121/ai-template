package com.xingchen.oa.boot.ai.tool;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 导航/功能知识工具（§4）：list_functions / open_function。菜单按用户功能权限过滤。 */
@Component
@RequiredArgsConstructor
public class NavTools {

    private final AiToolSupport support;

    private List<NavCatalog.Item> visible() {
        return NavCatalog.ITEMS.stream()
                .filter(i -> i.perm() == null || support.hasPerm(i.perm()))
                .toList();
    }

    @AiTool(name = "list_functions",
            description = "列出当前用户可见的系统功能菜单及说明，用于介绍系统能力或推荐入口。无参数。")
    public ToolResult listFunctions(Map<String, Object> args) {
        List<NavCatalog.Item> items = visible();
        List<Map<String, Object>> forLlm = new ArrayList<>();
        List<Map<String, String>> links = new ArrayList<>();
        for (NavCatalog.Item i : items) {
            forLlm.add(Map.of("title", i.title(), "path", i.path(), "desc", i.desc()));
            links.add(Map.of("title", i.title(), "path", i.path()));
        }
        return ToolResult.of(support.toJson(Map.of("functions", forLlm)),
                support.linkCard(links));
    }

    @AiTool(name = "open_function",
            description = "按名称或用户意图匹配一个功能菜单并给出打开入口。参数 query=功能名或意图关键词。",
            paramsSchema = "{\"query\":{\"type\":\"string\",\"description\":\"功能名或意图，如 请假、发文、我的待办\"}}",
            required = {"query"})
    public ToolResult openFunction(Map<String, Object> args) {
        String query = String.valueOf(args.getOrDefault("query", "")).trim();
        List<NavCatalog.Item> items = visible();
        NavCatalog.Item hit = items.stream().filter(i -> i.title().contains(query) || query.contains(i.title()))
                .findFirst().orElseGet(() -> items.stream()
                        .filter(i -> i.desc().contains(query) || i.path().contains(query.toLowerCase()))
                        .findFirst().orElse(null));
        if (hit == null) {
            return ToolResult.of(support.toJson(Map.of("matched", false,
                    "hint", "未匹配到功能，可先用 list_functions 查看全部可见功能")));
        }
        return ToolResult.of(support.toJson(Map.of("matched", true, "title", hit.title(), "path", hit.path())),
                support.navigateCard(hit.path(), hit.title(), hit.desc()));
    }
}
