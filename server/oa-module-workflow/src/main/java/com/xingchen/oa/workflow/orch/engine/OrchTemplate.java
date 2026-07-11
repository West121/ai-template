package com.xingchen.oa.workflow.orch.engine;

import com.xingchen.oa.workflow.engine.expression.ExpressionService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 编排模板插值（契约 §2）：{@code {{Aviator 表达式}}}，上下文 = payload / vars / outputs。
 * 前后端插值语法以此为准（前端只做提示不求值）。复用平台 {@link ExpressionService}（Aviator 沙箱 +
 * {@code @FormulaFunction} 扩展函数：now/today/uuid/dateFormat/jsonGet/workDays/…）。
 */
@Component
@RequiredArgsConstructor
public class OrchTemplate {

    private static final Pattern EXPR = Pattern.compile("\\{\\{(.+?)}}", Pattern.DOTALL);

    private final ExpressionService expressionService;

    /**
     * 字符串模板渲染：替换全部 {@code {{expr}}} 为求值结果字符串；
     * 整串恰为单个 {@code {{expr}}} 时返回原始对象（供 JSON body / formData 传结构化值）。
     */
    public Object render(String template, Map<String, Object> ctx) {
        if (template == null) {
            return null;
        }
        Matcher whole = EXPR.matcher(template.trim());
        if (whole.matches()) {
            return eval(whole.group(1).trim(), ctx);
        }
        Matcher m = EXPR.matcher(template);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            Object v = eval(m.group(1).trim(), ctx);
            m.appendReplacement(sb, Matcher.quoteReplacement(v == null ? "" : String.valueOf(v)));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    /** 字符串渲染（强制字符串输出）。 */
    public String renderString(String template, Map<String, Object> ctx) {
        Object v = render(template, ctx);
        return v == null ? null : String.valueOf(v);
    }

    /** 裸 Aviator 表达式求值（dataMap/end/loop/条件等场景）。 */
    public Object eval(String expr, Map<String, Object> ctx) {
        return expressionService.eval(expr, ctx);
    }

    public boolean evalBoolean(String expr, Map<String, Object> ctx) {
        return expressionService.evalBoolean(expr, ctx);
    }
}
