package com.xingchen.oa.office.service;

import com.googlecode.aviator.AviatorEvaluator;
import com.googlecode.aviator.AviatorEvaluatorInstance;
import com.googlecode.aviator.EvalMode;
import com.googlecode.aviator.Feature;
import com.googlecode.aviator.Options;
import com.googlecode.aviator.runtime.function.AbstractFunction;
import com.googlecode.aviator.runtime.function.FunctionUtils;
import com.googlecode.aviator.runtime.type.AviatorObject;
import com.googlecode.aviator.runtime.type.AviatorRuntimeJavaType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 单据模板「计算配置」求值（bizdoc-design.md §12）。
 *
 * <p>模板 content v2 的 {@code calc} 段产出命名变量，模板经 {@code {{变量名}}} 引用。计算在<b>后端出数据时</b>
 * 求值（render-data 与 BIZDOC {@code docs/{id}/print} 同路径），结果按格式化落入 data map。两条路径都调
 * {@link #apply(String, String, Map)}。
 *
 * <h3>求值顺序</h3>
 * <ol>
 *   <li><b>aggregates</b>：子表（{@code source} 字段的数组）按 {@code field} 列做 SUM/AVG/MAX/MIN/COUNT；</li>
 *   <li><b>computed</b>：Aviator 公式，上下文 = 表单标量字段 + 已算出的聚合变量（故 computed 可引聚合名）。</li>
 * </ol>
 *
 * <h3>格式化</h3>
 * {@code format=number} → BigDecimal 定标 {@code scale}（缺省 2，HALF_UP）；{@code format=chinese} →
 * {@link #numberToChinese} 人民币大写。
 *
 * <h3>容错与优先级</h3>
 * <ul>
 *   <li>坏公式 / 缺数据 / 非数值格式化失败：该变量置 {@code "-"}，<b>不阻断打印</b>；</li>
 *   <li>变量名与既有键（表单字段 / 系统字段）冲突时 calc <b>优先级最低</b>（{@code putIfAbsent}，不踩既有值）。</li>
 * </ul>
 *
 * <h3>沙箱</h3>
 * 自持一个 {@link AviatorEvaluatorInstance}（不依赖 oa-module-workflow 的 ExpressionService，遵守业务模块
 * 互不依赖约束），配置同工作流侧：解释执行 + 关停反射/静态/循环等危险特性。注册 {@code round/abs/numberToChinese}
 * 供公式内调用。
 */
@Slf4j
@Service
public class BizDocCalcService {

    /** AVG 中间除法保留精度（最终由各变量 scale 再定标）。 */
    private static final int DIV_SCALE = 10;

    private final AviatorEvaluatorInstance engine;
    private final ObjectMapper objectMapper;

    public BizDocCalcService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.engine = AviatorEvaluator.newInstance(EvalMode.INTERPRETER);
        engine.disableFeature(Feature.NewInstance);
        engine.disableFeature(Feature.Module);
        engine.disableFeature(Feature.Use);
        engine.disableFeature(Feature.StaticMethods);
        engine.disableFeature(Feature.StaticFields);
        engine.disableFeature(Feature.ForLoop);
        engine.disableFeature(Feature.WhileLoop);
        engine.setOption(Options.ALLOWED_CLASS_SET, Collections.<Class<?>>emptySet());
        engine.addFunction(new RoundFunction());
        engine.addFunction(new AbsFunction());
        engine.addFunction(new NumberToChineseFunction());
    }

    /**
     * 对含 {@code calc} 段的模板求值并把格式化结果并入 {@code data}（无 calc 段则 no-op）。
     *
     * @param tplContentJson 模板 content JSON（v2，可能含 {@code calc}）
     * @param formDataJson   单据/实例 form_data JSON（聚合子表与 computed 表单字段来源）
     * @param data           打印数据 map（就地写入；calc 优先级最低，不覆盖既有键）
     */
    public void apply(String tplContentJson, String formDataJson, Map<String, Object> data) {
        JsonNode content = parse(tplContentJson);
        if (content == null) {
            return;
        }
        JsonNode calc = content.path("calc");
        if (calc.isMissingNode() || !calc.isObject()) {
            return;
        }
        JsonNode formData = parse(formDataJson);
        // computed 上下文：表单标量字段（typed）+ 后续注入的聚合结果
        Map<String, Object> ctx = new HashMap<>();
        if (formData != null && formData.isObject()) {
            formData.properties().forEach(e -> {
                JsonNode v = e.getValue();
                if (v.isNumber()) {
                    // 整数归一（与 putScalarFormVars 口径一致：2.0 → 2）
                    ctx.put(e.getKey(), v.asDouble() % 1 == 0 ? (Object) v.asLong() : (Object) v.asDouble());
                } else if (v.isBoolean()) {
                    ctx.put(e.getKey(), v.asBoolean());
                } else if (v.isTextual()) {
                    ctx.put(e.getKey(), v.asString(""));
                }
            });
        }

        // ① aggregates
        JsonNode aggregates = calc.path("aggregates");
        if (aggregates.isArray()) {
            for (JsonNode agg : aggregates) {
                String name = text(agg, "name");
                if (!StringUtils.hasText(name)) {
                    continue;
                }
                try {
                    BigDecimal raw = computeAggregate(agg, formData);
                    // 数值形式注入上下文（供 computed 引用）：整数归一
                    double d = raw.doubleValue();
                    ctx.put(name, d % 1 == 0 ? (Object) (long) d : (Object) d);
                    data.putIfAbsent(name, format(raw, text(agg, "format"), intOrNull(agg, "scale")));
                } catch (Exception ex) {
                    data.putIfAbsent(name, "-");
                }
            }
        }

        // ② computed（可引表单字段与聚合结果）
        JsonNode computed = calc.path("computed");
        if (computed.isArray()) {
            for (JsonNode c : computed) {
                String name = text(c, "name");
                if (!StringUtils.hasText(name)) {
                    continue;
                }
                try {
                    String expr = text(c, "expr");
                    if (!StringUtils.hasText(expr)) {
                        throw new IllegalArgumentException("公式为空");
                    }
                    Object val = engine.compile(expr, true).execute(ctx);
                    ctx.put(name, val); // 允许后续 computed 链式引用
                    data.putIfAbsent(name, format(val, text(c, "format"), intOrNull(c, "scale")));
                } catch (Exception ex) {
                    data.putIfAbsent(name, "-");
                }
            }
        }
    }

    // ==================== 聚合 ====================

    /** 子表聚合：{@code source}=子表字段（数组），{@code field}=行内列，{@code fn}=SUM/AVG/MAX/MIN/COUNT。 */
    private BigDecimal computeAggregate(JsonNode agg, JsonNode formData) {
        String source = text(agg, "source");
        String field = text(agg, "field");
        String fnRaw = text(agg, "fn");
        if (!StringUtils.hasText(fnRaw)) {
            throw new IllegalArgumentException("聚合函数为空");
        }
        String fn = fnRaw.trim().toUpperCase();
        JsonNode arr = (formData == null || !StringUtils.hasText(source)) ? null : formData.path(source);
        List<BigDecimal> nums = new ArrayList<>();
        long rowCount = 0;
        if (arr != null && arr.isArray()) {
            for (JsonNode row : arr) {
                rowCount++;
                if (!"COUNT".equals(fn) && row != null && StringUtils.hasText(field)) {
                    BigDecimal cell = toDecimal(row.path(field));
                    if (cell != null) {
                        nums.add(cell);
                    }
                }
            }
        }
        switch (fn) {
            case "COUNT" -> {
                return BigDecimal.valueOf(rowCount);
            }
            case "SUM" -> {
                BigDecimal sum = BigDecimal.ZERO;
                for (BigDecimal b : nums) {
                    sum = sum.add(b);
                }
                return sum;
            }
            case "AVG" -> {
                if (nums.isEmpty()) {
                    throw new IllegalArgumentException("AVG 无数据");
                }
                BigDecimal sum = BigDecimal.ZERO;
                for (BigDecimal b : nums) {
                    sum = sum.add(b);
                }
                return sum.divide(BigDecimal.valueOf(nums.size()), DIV_SCALE, RoundingMode.HALF_UP);
            }
            case "MAX" -> {
                if (nums.isEmpty()) {
                    throw new IllegalArgumentException("MAX 无数据");
                }
                BigDecimal max = nums.get(0);
                for (BigDecimal b : nums) {
                    if (b.compareTo(max) > 0) {
                        max = b;
                    }
                }
                return max;
            }
            case "MIN" -> {
                if (nums.isEmpty()) {
                    throw new IllegalArgumentException("MIN 无数据");
                }
                BigDecimal min = nums.get(0);
                for (BigDecimal b : nums) {
                    if (b.compareTo(min) < 0) {
                        min = b;
                    }
                }
                return min;
            }
            default -> throw new IllegalArgumentException("不支持的聚合函数: " + fn);
        }
    }

    // ==================== 格式化 ====================

    /** 按 format 格式化；number=定标 scale（缺省 2），chinese=人民币大写；无/未知 format 输出原值。 */
    private String format(Object value, String format, Integer scale) {
        if (value == null) {
            return "-";
        }
        String fmt = format == null ? "" : format.trim().toLowerCase();
        if ("chinese".equals(fmt)) {
            return numberToChinese(toBigDecimal(value));
        }
        if ("number".equals(fmt)) {
            int s = scale != null ? Math.max(scale, 0) : 2;
            return toBigDecimal(value).setScale(s, RoundingMode.HALF_UP).toPlainString();
        }
        // 无/未知 format：字符串原样（如公式内 numberToChinese 返回值）；数值按 scale 定标或原样
        if (value instanceof String s) {
            return s;
        }
        if (value instanceof Number) {
            BigDecimal bd = toBigDecimal(value);
            return scale != null
                    ? bd.setScale(Math.max(scale, 0), RoundingMode.HALF_UP).toPlainString()
                    : bd.toPlainString();
        }
        return String.valueOf(value);
    }

    // ==================== 人民币大写 ====================

    private static final String[] DIGIT = {"零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"};
    private static final String[] SMALL_UNIT = {"", "拾", "佰", "仟"};      // 组内（个/十/百/千）
    private static final String[] BIG_UNIT = {"", "万", "亿", "兆"};         // 组间（每 4 位）

    /**
     * 人民币金额大写（如 {@code 1234.52 → 壹仟贰佰叁拾肆元伍角贰分}；整数补「整」，如 {@code 1200 → 壹仟贰佰元整}）。
     * 固定 2 位小数（角/分）；零金额=「零元整」；负数前缀「负」。
     */
    public static String numberToChinese(BigDecimal amount) {
        if (amount == null) {
            return "-";
        }
        amount = amount.setScale(2, RoundingMode.HALF_UP);
        boolean negative = amount.signum() < 0;
        amount = amount.abs();
        long fenTotal;
        try {
            fenTotal = amount.movePointRight(2).longValueExact();
        } catch (ArithmeticException e) {
            return amount.toPlainString(); // 超出 long 兜底，不抛
        }
        if (fenTotal == 0) {
            return "零元整";
        }
        long yuan = fenTotal / 100;
        int jiao = (int) ((fenTotal / 10) % 10);
        int fen = (int) (fenTotal % 10);

        StringBuilder sb = new StringBuilder();
        if (negative) {
            sb.append("负");
        }
        if (yuan > 0) {
            // 每 4 位分组（低位→高位）
            List<Integer> sections = new ArrayList<>();
            long y = yuan;
            while (y > 0) {
                sections.add((int) (y % 10000));
                y /= 10000;
            }
            boolean started = false;     // 已追加过非零组
            boolean pendingZero = false; // 上一组为零，非零组前需补单个「零」
            for (int si = sections.size() - 1; si >= 0; si--) {
                int sec = sections.get(si);
                if (sec == 0) {
                    if (started) {
                        pendingZero = true;
                    }
                    continue;
                }
                if (started && (pendingZero || sec < 1000)) {
                    sb.append(DIGIT[0]); // 组内不足千（高位缺）需「零」衔接，如 壹亿零壹万
                }
                pendingZero = false;
                sb.append(sectionToChinese(sec));
                sb.append(BIG_UNIT[si]);
                started = true;
            }
            sb.append("元");
        }
        if (jiao == 0 && fen == 0) {
            sb.append("整");
        } else {
            if (jiao == 0 && fen > 0 && yuan > 0) {
                sb.append(DIGIT[0]); // 元与分之间缺角补「零」，如 壹佰元零伍分
            }
            if (jiao > 0) {
                sb.append(DIGIT[jiao]).append("角");
            }
            if (fen > 0) {
                sb.append(DIGIT[fen]).append("分");
            }
        }
        return sb.toString();
    }

    /** 一组（1..9999）→ 大写，组内零折叠为单个「零」，尾零丢弃（如 1004→壹仟零肆，1200→壹仟贰佰）。 */
    private static String sectionToChinese(int sec) {
        StringBuilder sb = new StringBuilder();
        boolean zeroPending = false;
        boolean started = false;
        for (int pos = 3; pos >= 0; pos--) {
            int p = 1;
            for (int k = 0; k < pos; k++) {
                p *= 10;
            }
            int d = (sec / p) % 10;
            if (d == 0) {
                if (started) {
                    zeroPending = true;
                }
            } else {
                if (zeroPending) {
                    sb.append(DIGIT[0]);
                    zeroPending = false;
                }
                sb.append(DIGIT[d]).append(SMALL_UNIT[pos]);
                started = true;
            }
        }
        return sb.toString();
    }

    // ==================== Aviator 函数（公式内可用） ====================

    /** {@code round(x)} 取整（HALF_UP）→ Long；{@code round(x, n)} 定标 n 位 → Double。 */
    private static final class RoundFunction extends AbstractFunction {
        @Override
        public String getName() {
            return "round";
        }

        @Override
        public AviatorObject call(Map<String, Object> env, AviatorObject arg1) {
            BigDecimal v = num(arg1, env).setScale(0, RoundingMode.HALF_UP);
            return AviatorRuntimeJavaType.valueOf(v.longValueExact());
        }

        @Override
        public AviatorObject call(Map<String, Object> env, AviatorObject arg1, AviatorObject arg2) {
            int scale = num(arg2, env).intValue();
            BigDecimal v = num(arg1, env).setScale(Math.max(scale, 0), RoundingMode.HALF_UP);
            return AviatorRuntimeJavaType.valueOf(v.doubleValue());
        }
    }

    /** {@code abs(x)}：整数返回 Long，其余返回 Double。 */
    private static final class AbsFunction extends AbstractFunction {
        @Override
        public String getName() {
            return "abs";
        }

        @Override
        public AviatorObject call(Map<String, Object> env, AviatorObject arg1) {
            Number n = FunctionUtils.getNumberValue(arg1, env);
            if (n instanceof Long || n instanceof Integer || n instanceof BigInteger) {
                return AviatorRuntimeJavaType.valueOf(Math.abs(n.longValue()));
            }
            return AviatorRuntimeJavaType.valueOf(Math.abs(n.doubleValue()));
        }
    }

    /** {@code numberToChinese(x)}：人民币大写字符串。 */
    private static final class NumberToChineseFunction extends AbstractFunction {
        @Override
        public String getName() {
            return "numberToChinese";
        }

        @Override
        public AviatorObject call(Map<String, Object> env, AviatorObject arg1) {
            return AviatorRuntimeJavaType.valueOf(numberToChinese(num(arg1, env)));
        }
    }

    private static BigDecimal num(AviatorObject arg, Map<String, Object> env) {
        Number n = FunctionUtils.getNumberValue(arg, env);
        return toBigDecimal(n);
    }

    // ==================== 工具 ====================

    private static BigDecimal toBigDecimal(Object value) {
        if (value instanceof BigDecimal b) {
            return b;
        }
        if (value instanceof BigInteger bi) {
            return new BigDecimal(bi);
        }
        if (value instanceof Long || value instanceof Integer) {
            return BigDecimal.valueOf(((Number) value).longValue());
        }
        if (value instanceof Number n) {
            return new BigDecimal(n.toString());
        }
        if (value instanceof String s) {
            return new BigDecimal(s.trim()); // 非数值 → NumberFormatException（上层捕获置 "-"）
        }
        throw new IllegalArgumentException("非数值: " + value);
    }

    /** JsonNode → BigDecimal（数值直取；数值文本解析；否则 null）。 */
    private static BigDecimal toDecimal(JsonNode v) {
        if (v == null || v.isNull() || v.isMissingNode()) {
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

    private static String text(JsonNode node, String field) {
        return node == null ? null : node.path(field).asString(null);
    }

    private static Integer intOrNull(JsonNode node, String field) {
        if (node == null) {
            return null;
        }
        JsonNode v = node.path(field);
        return v.isNumber() ? v.asInt(0) : null;
    }

    private JsonNode parse(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }
}
