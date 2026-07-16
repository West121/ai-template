package com.hentor.oa.system.datadim;

import java.util.Set;

/**
 * 单个数据维度对当前用户解析出的可见范围。
 * <ul>
 *   <li>{@code all=true}：该维度不限（未配置 / 配了 ALL）——查询不为此维加谓词；</li>
 *   <li>否则（CUSTOM）：仅可见 {@code values} 集合内的取值——查询加 {@code col IN (values)}；
 *       空集合表示「配了 CUSTOM 但没选任何值」→ 该维度什么都看不到（默认更严）。</li>
 * </ul>
 */
public record DimensionScope(boolean all, Set<Long> values) {

    public static DimensionScope unlimited() {
        return new DimensionScope(true, Set.of());
    }

    public static DimensionScope custom(Set<Long> values) {
        return new DimensionScope(false, values == null ? Set.of() : Set.copyOf(values));
    }
}
