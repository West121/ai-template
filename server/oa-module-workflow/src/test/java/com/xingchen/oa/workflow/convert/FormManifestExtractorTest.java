package com.xingchen.oa.workflow.convert;

import com.xingchen.oa.workflow.dto.FieldDescriptor;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link FormManifestExtractor} 从在线表单 schemaJson 递归提取扁平字段清单单测。
 * <p>
 * 锁定契约（设计文档 2.2/2.3，供前端 N-F-07 对齐）：容器（grid/group/tabs/collapse）透明下钻、
 * 布局控件（divider/note/html）跳过；分组容器标题下沉为 group；子表单整体是一个字段，
 * 其列字段以 {@code 子表单key.列key} 前缀展开、group=子表单标题；选项/数据源随字段透传。
 */
class FormManifestExtractorTest {

    /** 含嵌套容器（group>grid）+ 子表单 + 布局控件 + 字典数据源的综合 schema。 */
    private static final String SCHEMA = """
            {
              "title": "报销单",
              "widgets": [
                {"id":"w1","type":"input","key":"title","label":"标题"},
                {"id":"g1","type":"group","label":"基本信息","children":[
                    {"id":"w2","type":"number","key":"amount","label":"金额"},
                    {"id":"grid1","type":"grid","props":{"columns":2},"children":[
                        {"id":"w3","type":"select","key":"category","label":"类别","options":["差旅","餐饮"]},
                        {"id":"w4","type":"date","key":"bizDate","label":"业务日期"}
                    ]}
                ]},
                {"id":"sf1","type":"subform","key":"details","label":"费用明细","children":[
                    {"id":"c1","type":"input","key":"item","label":"项目"},
                    {"id":"c2","type":"number","key":"price","label":"单价"}
                ]},
                {"id":"note1","type":"note","label":"仅说明"},
                {"id":"w5","type":"select","key":"dept","label":"部门",
                 "dataSource":{"type":"dict","dictCode":"sys_dept"}}
              ]
            }
            """;

    private Map<String, FieldDescriptor> byKey(List<FieldDescriptor> fields) {
        return fields.stream().collect(Collectors.toMap(FieldDescriptor::key, f -> f));
    }

    @Test
    void extractsFlatFieldsWithCorrectKeyLabelTypeGroup() {
        List<FieldDescriptor> fields = FormManifestExtractor.extract(SCHEMA);

        // 布局控件 note 被跳过；其余 8 个字段（含子表单本体 + 2 列）
        assertEquals(8, fields.size());
        List<String> keys = fields.stream().map(FieldDescriptor::key).toList();
        assertEquals(List.of(
                "title", "amount", "category", "bizDate",
                "details", "details.item", "details.price", "dept"), keys);

        Map<String, FieldDescriptor> m = byKey(fields);

        // 顶层字段无分组
        assertEquals("标题", m.get("title").label());
        assertEquals("input", m.get("title").type());
        assertNull(m.get("title").group());

        // 分组容器标题下沉为 group；grid 容器透明（bizDate 仍属「基本信息」）
        assertEquals("基本信息", m.get("amount").group());
        assertEquals("基本信息", m.get("category").group());
        assertEquals("基本信息", m.get("bizDate").group());
        assertEquals("number", m.get("amount").type());
        assertEquals("date", m.get("bizDate").type());
    }

    @Test
    void subformColumnsCarryPrefixAndGroup() {
        Map<String, FieldDescriptor> m = byKey(FormManifestExtractor.extract(SCHEMA));

        // 子表单整体：一个 subform 型字段，无分组前缀
        assertNotNull(m.get("details"));
        assertEquals("subform", m.get("details").type());
        assertEquals("费用明细", m.get("details").label());
        assertNull(m.get("details").group());

        // 子表单列：key 带「子表单key.」前缀、group=子表单标题
        assertEquals("input", m.get("details.item").type());
        assertEquals("项目", m.get("details.item").label());
        assertEquals("费用明细", m.get("details.item").group());
        assertEquals("number", m.get("details.price").type());
        assertEquals("费用明细", m.get("details.price").group());
    }

    @Test
    void optionsAndDataSourceAreCarried() {
        Map<String, FieldDescriptor> m = byKey(FormManifestExtractor.extract(SCHEMA));

        // 旧 string[] 选项归一化为 {label,value}
        List<FieldDescriptor.FieldOption> opts = m.get("category").options();
        assertNotNull(opts);
        assertEquals(2, opts.size());
        assertEquals("差旅", opts.get(0).label());
        assertEquals("差旅", opts.get(0).value());

        // 字典数据源原样透传
        Object ds = m.get("dept").dataSource();
        assertInstanceOf(Map.class, ds);
        @SuppressWarnings("unchecked")
        Map<String, Object> dsMap = (Map<String, Object>) ds;
        assertEquals("dict", dsMap.get("type"));
        assertEquals("sys_dept", dsMap.get("dictCode"));
        // 非选项字段无 options
        assertNull(m.get("dept").options());
    }

    @Test
    void emptyOrInvalidSchemaYieldsEmptyList() {
        assertTrue(FormManifestExtractor.extract(null).isEmpty());
        assertTrue(FormManifestExtractor.extract("").isEmpty());
        assertTrue(FormManifestExtractor.extract("not-json").isEmpty());
        assertTrue(FormManifestExtractor.extract("{\"widgets\":[]}").isEmpty());
        // 顶层直接是 widgets 数组（历史格式）也支持
        assertEquals(1, FormManifestExtractor.extract("[{\"id\":\"a\",\"type\":\"input\",\"key\":\"x\"}]").size());
    }
}
