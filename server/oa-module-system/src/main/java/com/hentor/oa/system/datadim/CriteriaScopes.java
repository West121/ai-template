package com.hentor.oa.system.datadim;

import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.Predicate;

import java.util.Collection;

/**
 * DP1b 数据权限可见集谓词构造（{@code col IN (集)}）。
 *
 * <p><b>为什么用 IN 而非 Hibernate array `@>`</b>：PostgreSQL 把 {@code col IN (...)} 优化为
 * {@code col = ANY(...)} 的<b>索引扫描</b>（压测：2001 部门 / 100w 行按 dept_id 过滤 count ≈ 93ms，走
 * idx_oa_approval_dept 索引扫描）。而 Hibernate Criteria 的 {@code arrayContains} 生成 PG {@code array @> ARRAY[col]}，
 * 该形式<b>不走 dept_id 索引</b>、退化为逐行数组包含检查（实测端点慢 ~40x），故弃用。
 *
 * <p><b>真·超大集（&gt; ~1 万元素，SQL/参数膨胀）</b>：应改原生 {@code col = ANY(?::bigint[])}（单数组参数，
 * harness 已验证同为索引扫描 93ms）——列 DP1b+ TODO（当前企业规模部门子树 ≤ 数千，IN 走索引已达标）。
 */
public final class CriteriaScopes {

    /** IN 元素数超此阈值时建议改原生 = ANY(?::bigint[])（避免 SQL/参数膨胀）；当前规模内 IN 即索引扫描。 */
    public static final int LARGE_SET_HINT = 10000;

    private CriteriaScopes() {
    }

    public static Predicate inOrAny(CriteriaBuilder cb, Expression<?> path, Collection<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return cb.disjunction(); // 空集 → 恒假（什么都看不到，默认更严）
        }
        return path.in(ids);
    }
}
