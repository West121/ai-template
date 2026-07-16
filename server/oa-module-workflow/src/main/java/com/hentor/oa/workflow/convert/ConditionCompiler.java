package com.hentor.oa.workflow.convert;

import com.hentor.oa.common.exception.BusinessException;
import tools.jackson.databind.JsonNode;

import java.util.Map;
import java.util.regex.Pattern;

/**
 * 结构化条件 → UEL 表达式编译（白名单操作符，禁止用户手写 UEL，避免注入）。
 * 输入：conditions = [{field, operator, value}, ...]；logic = AND|OR（缺省 AND）决定多条连接符。
 * 输出：${field op value && ...} 或 ${... || ...}
 */
public final class ConditionCompiler {

    private static final Pattern FIELD = Pattern.compile("^[A-Za-z_][A-Za-z0-9_]*$");

    /** 白名单操作符 → UEL 运算符 */
    private static final Map<String, String> OPS = Map.of(
            "==", "==", "!=", "!=", ">", ">", ">=", ">=", "<", "<", "<=", "<=");

    private ConditionCompiler() {
    }

    /**
     * 默认 AND 连接。
     *
     * @return UEL 表达式（含 ${}），条件为空返回 null（无条件流）
     */
    public static String compile(JsonNode conditions) {
        return compile(conditions, "AND");
    }

    /**
     * @param logic AND → {@code &&} / OR → {@code ||}（大小写不敏感，缺省 AND）
     * @return UEL 表达式（含 ${}），条件为空返回 null（无条件流）
     */
    public static String compile(JsonNode conditions, String logic) {
        if (conditions == null || !conditions.isArray() || conditions.isEmpty()) {
            return null;
        }
        String joiner = "OR".equalsIgnoreCase(logic) ? " || " : " && ";
        StringBuilder sb = new StringBuilder("${");
        boolean first = true;
        for (JsonNode c : conditions) {
            String field = c.path("field").asString(null);
            String op = c.path("operator").asString(null);
            JsonNode value = c.get("value");
            if (field == null || !FIELD.matcher(field).matches()) {
                throw new BusinessException(400, "条件字段非法: " + field);
            }
            if (!first) {
                sb.append(joiner);
            }
            first = false;
            // contains/notContains 编译为字符串方法调用（与前端 BPMN 设计器 compileUel 一致）；
            // 其余走白名单比较运算符。
            if ("contains".equals(op) || "notContains".equals(op)) {
                if ("notContains".equals(op)) {
                    sb.append('!');
                }
                sb.append(field).append(".contains(").append(stringLiteral(value)).append(')');
            } else {
                String uelOp = OPS.get(op);
                if (uelOp == null) {
                    throw new BusinessException(400, "不支持的条件操作符: " + op);
                }
                sb.append(field).append(' ').append(uelOp).append(' ').append(literal(value));
            }
        }
        sb.append('}');
        return sb.toString();
    }

    private static String literal(JsonNode value) {
        if (value == null || value.isNull()) {
            return "null";
        }
        if (value.isNumber()) {
            return value.asString();
        }
        if (value.isBoolean()) {
            return String.valueOf(value.asBoolean());
        }
        String s = value.asString("");
        // 数字字符串按数字处理，否则加单引号并转义
        if (s.matches("^-?\\d+(\\.\\d+)?$")) {
            return s;
        }
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }

    /** 字符串字面量：始终单引号包裹并转义（contains/notContains 的参数须为字符串） */
    private static String stringLiteral(JsonNode value) {
        String s = value == null || value.isNull() ? "" : value.asString("");
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }

    /** 白名单校验（供单测/校验用途） */
    public static boolean supported(String op) {
        return OPS.containsKey(op) || "contains".equals(op) || "notContains".equals(op);
    }
}
