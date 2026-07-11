package com.xingchen.oa.workflow.orch.engine;

import com.googlecode.aviator.runtime.function.AbstractFunction;
import com.googlecode.aviator.runtime.function.FunctionUtils;
import com.googlecode.aviator.runtime.type.AviatorObject;
import com.googlecode.aviator.runtime.type.AviatorRuntimeJavaType;
import com.xingchen.oa.workflow.engine.expression.FormulaFunction;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 编排内置 Aviator 函数（P0，走既有 {@code @FormulaFunction} 注册表，模板/条件/取人公式全域可用）：
 * now() / today() / uuid() / dateFormat(value, pattern) / jsonGet(obj, "a.b.0.c")。
 */
public final class OrchFunctions {

    private OrchFunctions() {
    }

    /** now() → ISO 本地日期时间串（秒级），如 2026-07-11T10:00:00。 */
    @FormulaFunction("now() → 当前日期时间（ISO 串）")
    public static class NowFunction extends AbstractFunction {
        @Override
        public String getName() {
            return "now";
        }

        @Override
        public AviatorObject call(Map<String, Object> env) {
            return AviatorRuntimeJavaType.valueOf(
                    LocalDateTime.now().withNano(0).format(DateTimeFormatter.ISO_LOCAL_DATE_TIME));
        }
    }

    /** today() → 当日日期串，如 2026-07-11。 */
    @FormulaFunction("today() → 当日日期（yyyy-MM-dd）")
    public static class TodayFunction extends AbstractFunction {
        @Override
        public String getName() {
            return "today";
        }

        @Override
        public AviatorObject call(Map<String, Object> env) {
            return AviatorRuntimeJavaType.valueOf(LocalDate.now().toString());
        }
    }

    /** uuid() → 随机 UUID 串。 */
    @FormulaFunction("uuid() → 随机 UUID")
    public static class UuidFunction extends AbstractFunction {
        @Override
        public String getName() {
            return "uuid";
        }

        @Override
        public AviatorObject call(Map<String, Object> env) {
            return AviatorRuntimeJavaType.valueOf(UUID.randomUUID().toString());
        }
    }

    /** dateFormat(value, pattern)：value 支持 epoch 毫秒 / ISO 日期(时间)串；null 取当前时间。 */
    @FormulaFunction("dateFormat(value, pattern) → 日期格式化")
    public static class DateFormatFunction extends AbstractFunction {
        @Override
        public String getName() {
            return "dateFormat";
        }

        @Override
        public AviatorObject call(Map<String, Object> env, AviatorObject arg1, AviatorObject arg2) {
            Object raw = arg1.getValue(env);
            String pattern = FunctionUtils.getStringValue(arg2, env);
            LocalDateTime time;
            if (raw == null) {
                time = LocalDateTime.now();
            } else if (raw instanceof Number n) {
                time = LocalDateTime.ofInstant(Instant.ofEpochMilli(n.longValue()), ZoneId.systemDefault());
            } else {
                String s = String.valueOf(raw);
                time = s.length() <= 10 ? LocalDate.parse(s).atStartOfDay() : LocalDateTime.parse(s);
            }
            return AviatorRuntimeJavaType.valueOf(time.format(DateTimeFormatter.ofPattern(pattern)));
        }
    }

    /** jsonGet(obj, "a.b.0.c")：Map/List 点路径导航，越界/缺键返回 null。 */
    @FormulaFunction("jsonGet(obj, path) → 点路径取值（Map/List）")
    public static class JsonGetFunction extends AbstractFunction {
        @Override
        public String getName() {
            return "jsonGet";
        }

        @Override
        public AviatorObject call(Map<String, Object> env, AviatorObject arg1, AviatorObject arg2) {
            Object cur = arg1.getValue(env);
            String path = FunctionUtils.getStringValue(arg2, env);
            if (cur == null || path == null || path.isBlank()) {
                return AviatorRuntimeJavaType.valueOf(cur);
            }
            for (String seg : path.split("\\.")) {
                if (cur instanceof Map<?, ?> m) {
                    cur = m.get(seg);
                } else if (cur instanceof List<?> l) {
                    try {
                        int idx = Integer.parseInt(seg);
                        cur = idx >= 0 && idx < l.size() ? l.get(idx) : null;
                    } catch (NumberFormatException e) {
                        cur = null;
                    }
                } else {
                    cur = null;
                }
                if (cur == null) {
                    break;
                }
            }
            return AviatorRuntimeJavaType.valueOf(cur);
        }
    }
}
