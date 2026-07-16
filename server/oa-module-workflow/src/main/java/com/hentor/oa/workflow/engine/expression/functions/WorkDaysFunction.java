package com.hentor.oa.workflow.engine.expression.functions;

import com.googlecode.aviator.runtime.function.AbstractFunction;
import com.googlecode.aviator.runtime.function.FunctionUtils;
import com.googlecode.aviator.runtime.type.AviatorObject;
import com.googlecode.aviator.runtime.type.AviatorRuntimeJavaType;
import com.hentor.oa.workflow.engine.expression.FormulaFunction;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Map;

/**
 * 公式函数 {@code workDays(start, end)}：统计两个日期之间的工作日数（周一至周五，含首尾），返回 Long。
 * 示例 Tier1 白名单纯函数——纯日期计算、无副作用、无外部依赖（不读库）。
 *
 * <p>入参接受 {@code yyyy-MM-dd} 字符串或 {@link LocalDate} 对象；{@code end < start} 返回 0。
 * 用法：{@code workDays(startDate, endDate) > 3} 一类高级请假/出差条件。
 */
@FormulaFunction("workDays(start, end) → 两日期间工作日数（含首尾，周末除外）")
public class WorkDaysFunction extends AbstractFunction {

    @Override
    public String getName() {
        return "workDays";
    }

    @Override
    public AviatorObject call(Map<String, Object> env, AviatorObject arg1, AviatorObject arg2) {
        LocalDate start = toDate(arg1, env);
        LocalDate end = toDate(arg2, env);
        long count = 0;
        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
            DayOfWeek dow = d.getDayOfWeek();
            if (dow != DayOfWeek.SATURDAY && dow != DayOfWeek.SUNDAY) {
                count++;
            }
        }
        return AviatorRuntimeJavaType.valueOf(count);
    }

    /**
     * 归一化为 {@link LocalDate}：字符串字面量/变量走 {@code getStringValue}（{@code yyyy-MM-dd}），
     * 已是 {@link LocalDate} 的流程变量直用。
     */
    private LocalDate toDate(AviatorObject arg, Map<String, Object> env) {
        Object raw = arg.getValue(env);
        if (raw instanceof LocalDate d) {
            return d;
        }
        String s = FunctionUtils.getStringValue(arg, env);
        if (s == null || s.isBlank()) {
            throw new IllegalArgumentException("workDays 入参日期为空");
        }
        return LocalDate.parse(s);
    }
}
