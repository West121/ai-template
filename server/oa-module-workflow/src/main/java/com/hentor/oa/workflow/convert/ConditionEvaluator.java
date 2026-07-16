package com.hentor.oa.workflow.convert;

import tools.jackson.databind.JsonNode;

import java.math.BigDecimal;
import java.util.Map;
import java.util.Objects;

/**
 * 结构化条件离线求值（P3 流程预测用）：对与 {@link ConditionCompiler} 相同的结构化条件
 * [{field, operator, value}] + logic(AND|OR) 直接用当前表单值/流程变量求值，不经引擎 UEL。
 * 白名单操作符 == != &gt; &gt;= &lt; &lt;=，避免任何表达式注入面。
 */
public final class ConditionEvaluator {

    private ConditionEvaluator() {
    }

    /** 求值一组条件。conditions 为空视为恒真（无条件流/默认分支之外的兜底）。 */
    public static boolean eval(JsonNode conditions, String logic, Map<String, Object> values) {
        if (conditions == null || !conditions.isArray() || conditions.isEmpty()) {
            return true;
        }
        boolean or = "OR".equalsIgnoreCase(logic);
        boolean acc = !or; // AND 初值 true；OR 初值 false
        for (JsonNode c : conditions) {
            boolean one = evalOne(c, values);
            acc = or ? (acc || one) : (acc && one);
        }
        return acc;
    }

    private static boolean evalOne(JsonNode c, Map<String, Object> values) {
        String field = c.path("field").asString(null);
        String op = c.path("operator").asString(null);
        JsonNode value = c.get("value");
        if (field == null || op == null) {
            return false;
        }
        Object actual = values == null ? null : values.get(field);
        // 数值比较优先
        BigDecimal an = toDecimal(actual);
        BigDecimal bn = toDecimal(value);
        if (an != null && bn != null) {
            int cmp = an.compareTo(bn);
            return switch (op) {
                case "==" -> cmp == 0;
                case "!=" -> cmp != 0;
                case ">" -> cmp > 0;
                case ">=" -> cmp >= 0;
                case "<" -> cmp < 0;
                case "<=" -> cmp <= 0;
                default -> false;
            };
        }
        // 布尔 / 字符串比较
        String as = actual == null ? null : String.valueOf(actual);
        String bs = value == null || value.isNull() ? null
                : (value.isBoolean() ? String.valueOf(value.asBoolean()) : value.asString(""));
        return switch (op) {
            case "==" -> Objects.equals(as, bs);
            case "!=" -> !Objects.equals(as, bs);
            default -> false; // 非数值不支持大小比较
        };
    }

    private static BigDecimal toDecimal(Object o) {
        if (o == null) {
            return null;
        }
        if (o instanceof Number n) {
            return new BigDecimal(n.toString());
        }
        String s = String.valueOf(o).trim();
        if (s.matches("^-?\\d+(\\.\\d+)?$")) {
            return new BigDecimal(s);
        }
        return null;
    }

    private static BigDecimal toDecimal(JsonNode v) {
        if (v == null || v.isNull()) {
            return null;
        }
        if (v.isNumber()) {
            return v.decimalValue();
        }
        String s = v.asString("").trim();
        if (s.matches("^-?\\d+(\\.\\d+)?$")) {
            return new BigDecimal(s);
        }
        return null;
    }
}
