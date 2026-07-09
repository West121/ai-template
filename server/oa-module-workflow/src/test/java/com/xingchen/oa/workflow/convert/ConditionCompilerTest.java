package com.xingchen.oa.workflow.convert;

import com.xingchen.oa.common.exception.BusinessException;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link ConditionCompiler} 结构化条件 → UEL 编译单测。
 * <p>
 * 该编译器与前端 BPMN 设计器 {@code src/pages/workflow/designer/bpmn/oa/serde.ts} 的
 * {@code compileUel} 是互镜像关系：两侧产出的 UEL 必须字节级一致（AND→{@code " && "}、
 * OR→{@code " || "}、数值字面量不加引号、字符串单引号转义、contains/notContains 走
 * {@code field.contains('v')} / {@code !field.contains('v')}）。本文件以「期望字符串精确匹配」
 * 锁定该契约，任一侧改动必须同步（remediation-plan Q-02 / 跨端约束提醒）。
 */
class ConditionCompilerTest {

    private final JsonMapper mapper = JsonMapper.builder().build();

    private JsonNode json(String s) {
        return mapper.readTree(s);
    }

    /** 单条件、指定运算符、指定值 */
    private JsonNode cond(String field, String op, String valueJson) {
        return json("[{\"field\":\"" + field + "\",\"operator\":\"" + op + "\",\"value\":" + valueJson + "}]");
    }

    /* ---------- 各比较运算符（数值字面量不加引号） ---------- */

    @Test
    void eachComparisonOperatorCompiles() {
        assertEquals("${days == 3}", ConditionCompiler.compile(cond("days", "==", "3")));
        assertEquals("${days != 3}", ConditionCompiler.compile(cond("days", "!=", "3")));
        assertEquals("${days > 3}", ConditionCompiler.compile(cond("days", ">", "3")));
        assertEquals("${days >= 3}", ConditionCompiler.compile(cond("days", ">=", "3")));
        assertEquals("${days < 3}", ConditionCompiler.compile(cond("days", "<", "3")));
        assertEquals("${days <= 3}", ConditionCompiler.compile(cond("days", "<=", "3")));
    }

    /* ---------- AND / OR 连接（大小写不敏感，缺省 AND） ---------- */

    @Test
    void defaultLogicIsAnd() {
        JsonNode c = json("[{\"field\":\"a\",\"operator\":\">\",\"value\":1},"
                + "{\"field\":\"b\",\"operator\":\"<\",\"value\":2}]");
        assertEquals("${a > 1 && b < 2}", ConditionCompiler.compile(c));
    }

    @Test
    void orLogicCaseInsensitive() {
        JsonNode c = json("[{\"field\":\"a\",\"operator\":\">\",\"value\":1},"
                + "{\"field\":\"b\",\"operator\":\"<\",\"value\":2}]");
        assertEquals("${a > 1 || b < 2}", ConditionCompiler.compile(c, "OR"));
        assertEquals("${a > 1 || b < 2}", ConditionCompiler.compile(c, "or"));
        // 未知/缺省 logic → AND
        assertEquals("${a > 1 && b < 2}", ConditionCompiler.compile(c, "XOR"));
        assertEquals("${a > 1 && b < 2}", ConditionCompiler.compile(c, null));
    }

    /* ---------- contains / notContains（镜像前端方法调用形态） ---------- */

    @Test
    void containsCompilesToMethodCall() {
        assertEquals("${tags.contains('vip')}", ConditionCompiler.compile(cond("tags", "contains", "\"vip\"")));
    }

    @Test
    void notContainsCompilesToNegatedMethodCall() {
        assertEquals("${!tags.contains('vip')}", ConditionCompiler.compile(cond("tags", "notContains", "\"vip\"")));
    }

    @Test
    void containsAlwaysQuotesEvenNumericValue() {
        // contains 参数必须是字符串（String.contains 收 CharSequence），数字值也加引号 —— 与前端一致
        assertEquals("${code.contains('100')}", ConditionCompiler.compile(cond("code", "contains", "100")));
    }

    /* ---------- 字面量类型：数值/布尔/null/字符串 ---------- */

    @Test
    void booleanLiteralUnquoted() {
        assertEquals("${urgent == true}", ConditionCompiler.compile(cond("urgent", "==", "true")));
        assertEquals("${urgent != false}", ConditionCompiler.compile(cond("urgent", "!=", "false")));
    }

    @Test
    void nullLiteral() {
        assertEquals("${remark == null}", ConditionCompiler.compile(cond("remark", "==", "null")));
    }

    @Test
    void numericStringValueTreatedAsNumber() {
        // 值为字符串 "3" 但内容是数字 → 不加引号（与前端 uelLiteral 的数值正则一致）
        assertEquals("${days > 3}", ConditionCompiler.compile(cond("days", ">", "\"3\"")));
        assertEquals("${price >= 3.5}", ConditionCompiler.compile(cond("price", ">=", "\"3.5\"")));
        assertEquals("${delta == -2}", ConditionCompiler.compile(cond("delta", "==", "\"-2\"")));
    }

    @Test
    void nonNumericStringValueQuoted() {
        assertEquals("${status == 'APPROVED'}", ConditionCompiler.compile(cond("status", "==", "\"APPROVED\"")));
    }

    /* ---------- 注入防护：字符串转义 + 字段白名单 + 运算符白名单 ---------- */

    @Test
    void stringValueEscapesQuotesAndBackslash() {
        // 典型注入面：值中带单引号 / 反斜杠，必须转义，不能逃逸出字符串字面量
        JsonNode c = cond("name", "==", "\"O'Brien\"");
        assertEquals("${name == 'O\\'Brien'}", ConditionCompiler.compile(c));

        JsonNode inj = cond("q", "==", "\"1' || '1'=='1\"");
        assertEquals("${q == '1\\' || \\'1\\'==\\'1'}", ConditionCompiler.compile(inj));

        JsonNode bs = cond("path", "==", "\"a\\\\b\"");
        // 输入值为 a\b → 转义为 a\\b
        assertEquals("${path == 'a\\\\b'}", ConditionCompiler.compile(bs));
    }

    @Test
    void illegalFieldNameRejected() {
        assertThrows(BusinessException.class,
                () -> ConditionCompiler.compile(json("[{\"field\":\"days; DROP TABLE\",\"operator\":\">\",\"value\":3}]")));
        assertThrows(BusinessException.class,
                () -> ConditionCompiler.compile(json("[{\"field\":\"1days\",\"operator\":\">\",\"value\":3}]")));
        assertThrows(BusinessException.class,
                () -> ConditionCompiler.compile(json("[{\"field\":\"a.b\",\"operator\":\">\",\"value\":3}]")));
        assertThrows(BusinessException.class,
                () -> ConditionCompiler.compile(json("[{\"field\":\"a b\",\"operator\":\">\",\"value\":3}]")));
        assertThrows(BusinessException.class,
                () -> ConditionCompiler.compile(json("[{\"operator\":\">\",\"value\":3}]"))); // 缺 field
    }

    @Test
    void validFieldNamesAccepted() {
        assertEquals("${_x > 1}", ConditionCompiler.compile(cond("_x", ">", "1")));
        assertEquals("${aB_9 > 1}", ConditionCompiler.compile(cond("aB_9", ">", "1")));
    }

    @Test
    void unsupportedOperatorRejected() {
        assertThrows(BusinessException.class, () -> ConditionCompiler.compile(cond("days", "DROP", "3")));
        assertThrows(BusinessException.class, () -> ConditionCompiler.compile(cond("days", "=", "3")));
        assertThrows(BusinessException.class, () -> ConditionCompiler.compile(cond("days", "like", "3")));
    }

    /* ---------- 空/默认分支：无条件流返回 null ---------- */

    @Test
    void emptyOrNullReturnsNull() {
        assertNull(ConditionCompiler.compile(null));
        assertNull(ConditionCompiler.compile(json("[]")));
        assertNull(ConditionCompiler.compile(json("{}")));      // 非数组
        assertNull(ConditionCompiler.compile(json("\"x\""))); // 非数组
    }

    /* ---------- 多条件混合：contains + 比较 ---------- */

    @Test
    void mixedContainsAndComparison() {
        JsonNode c = json("[{\"field\":\"tags\",\"operator\":\"contains\",\"value\":\"vip\"},"
                + "{\"field\":\"amount\",\"operator\":\">\",\"value\":1000}]");
        assertEquals("${tags.contains('vip') && amount > 1000}", ConditionCompiler.compile(c));
        assertEquals("${tags.contains('vip') || amount > 1000}", ConditionCompiler.compile(c, "OR"));
    }

    /* ---------- supported() 白名单查询辅助 ---------- */

    @Test
    void supportedReflectsWhitelist() {
        for (String op : new String[]{"==", "!=", ">", ">=", "<", "<=", "contains", "notContains"}) {
            assertTrue(ConditionCompiler.supported(op), op);
        }
        for (String op : new String[]{"DROP", "=", "like", "", "in"}) {
            assertFalse(ConditionCompiler.supported(op), op);
        }
    }
}
