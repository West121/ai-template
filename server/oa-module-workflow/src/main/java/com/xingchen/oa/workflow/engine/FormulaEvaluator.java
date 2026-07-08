package com.xingchen.oa.workflow.engine;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 办理人「自定义公式」受限求值引擎（kind=FORMULA）。自研轻量递归下降解析器，
 * 不引入表达式库依赖。白名单函数 + 逻辑/比较运算，结合表单数据/申请人上下文求值，
 * 返回 userId 集合。
 *
 * <p>支持：
 * <ul>
 *   <li>取人函数：{@code USER(id...) / ROLE("名称") / DEPT(id) / POST("名称") / DEPT_LEADER(level) / INITIATOR()} → 用户集合；</li>
 *   <li>逻辑：{@code IF(cond, a, b)}、{@code AND(...)}、{@code OR(...)}、{@code NOT(x)}，以及中缀 {@code && || !}、关键字 AND/OR/NOT；</li>
 *   <li>比较：{@code > < >= <= == !=}；</li>
 *   <li>操作数：表单字段标识符、数字、字符串（单/双引号）、true/false。</li>
 * </ul>
 * 示例：{@code IF(days>3, ROLE("总经理"), DEPT_LEADER(1))}。求值异常/类型不符时返回空集（由调用方降级 + 日志）。
 */
public final class FormulaEvaluator {

    /** 组织/上下文取数回调，由 AssigneeResolver 提供具体实现。 */
    public interface Context {
        Object variable(String name);

        Set<Long> user(long id);

        Set<Long> usersByRoleName(String name);

        Set<Long> usersByPostName(String name);

        Set<Long> membersOfDept(long deptId);

        Set<Long> deptLeader(int level);

        Set<Long> initiator();
    }

    private final Context ctx;
    private final String src;
    private int pos;

    private FormulaEvaluator(String src, Context ctx) {
        this.src = src == null ? "" : src;
        this.ctx = ctx;
    }

    /** 解析并求值公式，返回办理人 id 集合；结果非用户集合或解析失败均返回空集。 */
    public static Set<Long> eval(String formula, Context ctx) {
        if (formula == null || formula.isBlank()) {
            return new LinkedHashSet<>();
        }
        FormulaEvaluator ev = new FormulaEvaluator(formula, ctx);
        Object v = ev.parseExpr();
        ev.skipWs();
        if (ev.pos < ev.src.length()) {
            throw new IllegalStateException("公式尾部无法解析: " + ev.src.substring(ev.pos));
        }
        return toUserSet(v);
    }

    @SuppressWarnings("unchecked")
    private static Set<Long> toUserSet(Object v) {
        if (v instanceof Set<?> s) {
            Set<Long> out = new LinkedHashSet<>();
            for (Object o : s) {
                if (o instanceof Long l) {
                    out.add(l);
                } else if (o instanceof Number n) {
                    out.add(n.longValue());
                }
            }
            return out;
        }
        return new LinkedHashSet<>();
    }

    /* ------------ 递归下降 ------------ */

    private Object parseExpr() {
        return parseOr();
    }

    private Object parseOr() {
        Object left = parseAnd();
        while (true) {
            skipWs();
            if (matchOp("||") || matchKeyword("OR")) {
                Object right = parseAnd();
                left = truthy(left) || truthy(right);
            } else {
                return left;
            }
        }
    }

    private Object parseAnd() {
        Object left = parseNot();
        while (true) {
            skipWs();
            if (matchOp("&&") || matchKeyword("AND")) {
                Object right = parseNot();
                left = truthy(left) && truthy(right);
            } else {
                return left;
            }
        }
    }

    private Object parseNot() {
        skipWs();
        if (matchOp("!") || matchKeyword("NOT")) {
            return !truthy(parseNot());
        }
        return parseComparison();
    }

    private Object parseComparison() {
        Object left = parsePrimary();
        skipWs();
        for (String op : new String[]{">=", "<=", "==", "!=", ">", "<"}) {
            if (matchOp(op)) {
                Object right = parsePrimary();
                return compare(left, right, op);
            }
        }
        return left;
    }

    private Object parsePrimary() {
        skipWs();
        if (pos >= src.length()) {
            throw new IllegalStateException("公式意外结束");
        }
        char c = src.charAt(pos);
        if (c == '(') {
            pos++;
            Object v = parseExpr();
            skipWs();
            expect(')');
            return v;
        }
        if (c == '"' || c == '\'') {
            return parseString(c);
        }
        if (c == '-' || Character.isDigit(c)) {
            return parseNumber();
        }
        if (Character.isLetter(c) || c == '_') {
            return parseIdentOrCall();
        }
        throw new IllegalStateException("公式无法解析字符: " + c);
    }

    private Object parseIdentOrCall() {
        String name = readIdent();
        skipWs();
        if (pos < src.length() && src.charAt(pos) == '(') {
            pos++;
            List<Object> args = parseArgs();
            expect(')');
            return callFunction(name, args);
        }
        // 标识符 = 表单字段/上下文变量；关键字 true/false
        if ("true".equalsIgnoreCase(name)) {
            return Boolean.TRUE;
        }
        if ("false".equalsIgnoreCase(name)) {
            return Boolean.FALSE;
        }
        return ctx.variable(name);
    }

    /** IF 需要惰性求值分支，故按未求值的原始 token 处理；其余函数参数求值后传入。 */
    private Object callFunction(String name, List<Object> args) {
        String fn = name.toUpperCase();
        switch (fn) {
            case "USER" -> {
                Set<Long> out = new LinkedHashSet<>();
                for (Object a : args) {
                    Long id = asLong(a);
                    if (id != null) {
                        out.addAll(ctx.user(id));
                    }
                }
                return out;
            }
            case "ROLE" -> {
                return arg0String(args) == null ? new LinkedHashSet<Long>()
                        : ctx.usersByRoleName(arg0String(args));
            }
            case "POST" -> {
                return arg0String(args) == null ? new LinkedHashSet<Long>()
                        : ctx.usersByPostName(arg0String(args));
            }
            case "DEPT" -> {
                Long id = args.isEmpty() ? null : asLong(args.get(0));
                return id == null ? new LinkedHashSet<Long>() : ctx.membersOfDept(id);
            }
            case "DEPT_LEADER" -> {
                int level = args.isEmpty() ? 1 : (asLong(args.get(0)) == null ? 1 : asLong(args.get(0)).intValue());
                return ctx.deptLeader(level);
            }
            case "INITIATOR" -> {
                return ctx.initiator();
            }
            case "IF" -> {
                if (args.size() < 2) {
                    return new LinkedHashSet<Long>();
                }
                boolean cond = truthy(args.get(0));
                if (cond) {
                    return args.get(1);
                }
                return args.size() >= 3 ? args.get(2) : new LinkedHashSet<Long>();
            }
            case "AND" -> {
                for (Object a : args) {
                    if (!truthy(a)) {
                        return Boolean.FALSE;
                    }
                }
                return Boolean.TRUE;
            }
            case "OR" -> {
                for (Object a : args) {
                    if (truthy(a)) {
                        return Boolean.TRUE;
                    }
                }
                return Boolean.FALSE;
            }
            case "NOT" -> {
                return !(args.size() == 1 && truthy(args.get(0)));
            }
            default -> throw new IllegalStateException("未知公式函数: " + name);
        }
    }

    private List<Object> parseArgs() {
        List<Object> args = new ArrayList<>();
        skipWs();
        if (pos < src.length() && src.charAt(pos) == ')') {
            return args;
        }
        while (true) {
            args.add(parseExpr());
            skipWs();
            if (pos < src.length() && src.charAt(pos) == ',') {
                pos++;
            } else {
                return args;
            }
        }
    }

    /* ------------ 词法 ------------ */

    private String readIdent() {
        int start = pos;
        while (pos < src.length()) {
            char c = src.charAt(pos);
            if (Character.isLetterOrDigit(c) || c == '_' || c == '.') {
                pos++;
            } else {
                break;
            }
        }
        return src.substring(start, pos);
    }

    private Object parseString(char quote) {
        pos++; // 开引号
        StringBuilder sb = new StringBuilder();
        while (pos < src.length() && src.charAt(pos) != quote) {
            char c = src.charAt(pos);
            if (c == '\\' && pos + 1 < src.length()) {
                pos++;
                sb.append(src.charAt(pos));
            } else {
                sb.append(c);
            }
            pos++;
        }
        expect(quote);
        return sb.toString();
    }

    private Object parseNumber() {
        int start = pos;
        if (src.charAt(pos) == '-') {
            pos++;
        }
        while (pos < src.length() && (Character.isDigit(src.charAt(pos)) || src.charAt(pos) == '.')) {
            pos++;
        }
        return Double.valueOf(src.substring(start, pos));
    }

    private boolean matchOp(String op) {
        skipWs();
        if (src.regionMatches(pos, op, 0, op.length())) {
            // 避免把 >= 误配成 >：调用方按长度优先顺序尝试
            pos += op.length();
            return true;
        }
        return false;
    }

    private boolean matchKeyword(String kw) {
        skipWs();
        if (src.regionMatches(true, pos, kw, 0, kw.length())) {
            int end = pos + kw.length();
            // 关键字边界：其后不能是标识符字符
            if (end >= src.length() || !(Character.isLetterOrDigit(src.charAt(end)) || src.charAt(end) == '_')) {
                pos = end;
                return true;
            }
        }
        return false;
    }

    private void expect(char c) {
        if (pos >= src.length() || src.charAt(pos) != c) {
            throw new IllegalStateException("公式缺少 '" + c + "'");
        }
        pos++;
    }

    private void skipWs() {
        while (pos < src.length() && Character.isWhitespace(src.charAt(pos))) {
            pos++;
        }
    }

    /* ------------ 值语义 ------------ */

    private static boolean truthy(Object v) {
        if (v == null) {
            return false;
        }
        if (v instanceof Boolean b) {
            return b;
        }
        if (v instanceof Number n) {
            return n.doubleValue() != 0;
        }
        if (v instanceof Set<?> s) {
            return !s.isEmpty();
        }
        if (v instanceof String s) {
            return !s.isBlank();
        }
        return true;
    }

    private static Object compare(Object left, Object right, String op) {
        Double ln = numeric(left);
        Double rn = numeric(right);
        if (ln != null && rn != null) {
            return switch (op) {
                case ">" -> ln > rn;
                case "<" -> ln < rn;
                case ">=" -> ln >= rn;
                case "<=" -> ln <= rn;
                case "==" -> ln.doubleValue() == rn.doubleValue();
                case "!=" -> ln.doubleValue() != rn.doubleValue();
                default -> Boolean.FALSE;
            };
        }
        // 非数值：按字符串等值比较
        String ls = String.valueOf(left);
        String rs = String.valueOf(right);
        boolean eq = ls.equals(rs);
        return switch (op) {
            case "==" -> eq;
            case "!=" -> !eq;
            default -> Boolean.FALSE;
        };
    }

    private static Double numeric(Object v) {
        if (v instanceof Number n) {
            return n.doubleValue();
        }
        if (v instanceof Boolean b) {
            return b ? 1.0 : 0.0;
        }
        if (v instanceof String s) {
            try {
                return Double.valueOf(s.trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private static Long asLong(Object v) {
        Double d = numeric(v);
        return d == null ? null : d.longValue();
    }

    private static String arg0String(List<Object> args) {
        if (args.isEmpty() || args.get(0) == null) {
            return null;
        }
        return String.valueOf(args.get(0));
    }
}
