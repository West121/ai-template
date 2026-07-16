package com.hentor.oa.workflow.engine;

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

        /**
         * 未知函数（非取人/逻辑内置函数）委托求值：交由后端可扩展的 {@code @FormulaFunction} 注册表
         * （与计算/条件公式共用同一批函数，如 {@code workDays/deptLeader/dictLabel} 及业务自定义函数）。
         * 参数在调用前已全部求值为 Java 值传入。若该名称未注册为自定义函数应抛异常
         * （由调用方按未知函数处理），求值失败亦抛异常（由 AssigneeResolver 统一降级空集）。
         */
        Object customFunction(String name, List<Object> args);
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

    private static Set<Long> toUserSet(Object v) {
        Set<Long> out = new LinkedHashSet<>();
        collectIds(v, out);
        return out;
    }

    /**
     * 归约为用户 id 集合：集合/可迭代逐项归约；单个数字（如自定义函数 {@code deptLeader(user)} 直接返回
     * 负责人 id）视为单人。非数字/非集合（布尔比较结果、字符串等）不产人 → 空集（由调用方再降级）。
     */
    private static void collectIds(Object v, Set<Long> out) {
        if (v instanceof Long l) {
            out.add(l);
        } else if (v instanceof Number n) {
            out.add(n.longValue());
        } else if (v instanceof Iterable<?> it) {
            for (Object o : it) {
                collectIds(o, out);
            }
        }
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

    /**
     * 函数调用：参数在 {@link #parseArgs()} 阶段已全部求值后传入——本求值器「解析与求值合一」，
     * 无独立 AST，故 IF 实为「先全量求值两个分支、再择一返回」而非惰性求值。
     * 取人函数（USER/ROLE/POST/DEPT/DEPT_LEADER/INITIATOR）失败时统一降级为空集且无副作用，
     * 因此全量求值与「只算命中分支」的结果一致，代价仅是对未命中分支多一次无用的名称解析。
     * 如需真正惰性，需改造为「先构建 AST，再按条件只求值命中分支」，改动面较大且可能影响现有降级语义，
     * 收益（省一次解析）不足以承担该风险，故此处仅澄清注释与实现一致（B-16）。
     */
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
            // 非取人/逻辑内置函数：委托给后端可扩展的 @FormulaFunction 注册表求值
            // （与计算/条件公式共享同一批函数）。未注册者由 Context 抛异常，按未知函数处理。
            default -> {
                return ctx.customFunction(name, args);
            }
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
