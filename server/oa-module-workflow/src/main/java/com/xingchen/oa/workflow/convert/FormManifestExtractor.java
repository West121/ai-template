package com.xingchen.oa.workflow.convert;

import com.xingchen.oa.workflow.dto.FieldDescriptor;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * 在线表单 schemaJson → 扁平字段清单提取。与前端 {@code src/lib/form-runtime.ts} 的
 * {@code collectDataWidgets} 同源：容器（grid/group/tabs/collapse）透明下钻、布局控件
 * （divider/note/html）跳过。区别在于本端把<b>子表单列</b>也展开为独立字段（key 带
 * {@code 子表单key.列key} 前缀、group=子表单标题），以便「节点字段权限编辑器」按字段粒度配权限。
 *
 * <p>提取结果仅含可配置字段的元数据（key/label/type/group + 可选 options/dataSource），
 * 不含值、校验、联动等运行时细节。
 */
public final class FormManifestExtractor {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    /** 纯布局控件：不产生字段。 */
    private static final Set<String> LAYOUT_TYPES = Set.of("divider", "note", "html");
    /** 容器控件：透明，仅下钻 children。 */
    private static final Set<String> CONTAINER_TYPES = Set.of("grid", "group", "tabs", "collapse");
    /** 选项型控件：携带 options。 */
    private static final Set<String> OPTION_TYPES = Set.of("radio", "checkbox", "select");
    private static final String SUBFORM = "subform";

    private FormManifestExtractor() {
    }

    /**
     * 从 schemaJson 提取扁平字段清单。
     *
     * @param schemaJson 前端表单设计器 FormSchema JSON（{@code {title,widgets:[...],...}}），
     *                   或历史上的顶层 widgets 数组
     * @return 扁平字段列表；schema 为空/非法时返回空列表（不抛异常）
     */
    public static List<FieldDescriptor> extract(String schemaJson) {
        List<FieldDescriptor> out = new ArrayList<>();
        if (schemaJson == null || schemaJson.isBlank()) {
            return out;
        }
        JsonNode root;
        try {
            root = MAPPER.readTree(schemaJson);
        } catch (Exception e) {
            return out;
        }
        JsonNode widgets = root.isArray() ? root : root.path("widgets");
        if (widgets == null || !widgets.isArray()) {
            return out;
        }
        walk(widgets, null, out);
        return out;
    }

    private static void walk(JsonNode widgets, String group, List<FieldDescriptor> out) {
        for (JsonNode w : widgets) {
            String type = w.path("type").asString(null);
            if (type == null || LAYOUT_TYPES.contains(type)) {
                continue;
            }
            if (CONTAINER_TYPES.contains(type)) {
                // 分组容器把自身标题作为下级字段的 group 上下文（更内层/子表单会覆盖）
                String childGroup = "group".equals(type) ? firstNonBlank(labelOf(w), group) : group;
                JsonNode children = w.path("children");
                if (children.isArray()) {
                    walk(children, childGroup, out);
                }
                continue;
            }
            if (SUBFORM.equals(type)) {
                String subKey = keyOf(w);
                String subLabel = firstNonBlank(labelOf(w), subKey);
                // 子表单整体也是一个（数组型）可配字段
                out.add(descriptor(subKey, subLabel, type, group, w));
                // 列字段：带前缀 + 以子表单标题为 group
                JsonNode cols = w.path("children");
                if (cols.isArray()) {
                    for (JsonNode col : cols) {
                        String colType = col.path("type").asString(null);
                        if (colType == null || LAYOUT_TYPES.contains(colType) || CONTAINER_TYPES.contains(colType)) {
                            continue;
                        }
                        String colKey = subKey + "." + keyOf(col);
                        out.add(descriptor(colKey, firstNonBlank(labelOf(col), keyOf(col)), colType, subLabel, col));
                    }
                }
                continue;
            }
            // 普通数据控件
            out.add(descriptor(keyOf(w), firstNonBlank(labelOf(w), keyOf(w)), type, group, w));
        }
    }

    private static FieldDescriptor descriptor(String key, String label, String type, String group, JsonNode w) {
        return new FieldDescriptor(key, label, type, group, options(w), dataSource(w));
    }

    /** 字段键：稳定 key 优先，回退 id。 */
    private static String keyOf(JsonNode w) {
        String key = w.path("key").asString(null);
        if (key != null && !key.isBlank()) {
            return key;
        }
        return w.path("id").asString("");
    }

    /** 显示名：label 优先，回退容器 props.title。 */
    private static String labelOf(JsonNode w) {
        String label = w.path("label").asString(null);
        if (label != null && !label.isBlank()) {
            return label;
        }
        return w.path("props").path("title").asString(null);
    }

    /** 选项归一化（兼容旧 string[] 与 {label,value}[]）；无则 null。 */
    private static List<FieldDescriptor.FieldOption> options(JsonNode w) {
        String type = w.path("type").asString("");
        JsonNode opts = w.path("options");
        if (!OPTION_TYPES.contains(type) || !opts.isArray() || opts.isEmpty()) {
            return null;
        }
        List<FieldDescriptor.FieldOption> list = new ArrayList<>();
        for (JsonNode o : opts) {
            if (o.isTextual()) {
                String v = o.asString("");
                list.add(new FieldDescriptor.FieldOption(v, v));
            } else if (o.isObject()) {
                String value = o.path("value").asString("");
                String label = o.path("label").asString(value);
                list.add(new FieldDescriptor.FieldOption(label, value));
            }
        }
        return list.isEmpty() ? null : list;
    }

    /** 数据源原样透传（字典/关联表单/接口等）；无则 null。 */
    private static Object dataSource(JsonNode w) {
        JsonNode ds = w.get("dataSource");
        if (ds == null || ds.isNull() || !ds.isObject()) {
            return null;
        }
        return MAPPER.convertValue(ds, Object.class);
    }

    private static String firstNonBlank(String a, String b) {
        return (a != null && !a.isBlank()) ? a : b;
    }
}
