package com.xingchen.oa.common.security;

import java.util.Set;

/**
 * 数据权限可见范围（由当前激活身份的角色 data_scope 解析而来）。
 *
 * <ul>
 *   <li>{@code all=true}：可见全部数据，查询不加过滤；</li>
 *   <li>{@code selfOnly=true}（且 deptIds 为空）：仅可见 applicant_id = userId 的数据；</li>
 *   <li>否则：可见 dept_id IN deptIds OR applicant_id = userId 的数据。</li>
 * </ul>
 */
public record DataScope(
        boolean all,
        boolean selfOnly,
        Set<Long> deptIds,
        Long userId
) {

    public static DataScope all(Long userId) {
        return new DataScope(true, false, Set.of(), userId);
    }

    public static DataScope self(Long userId) {
        return new DataScope(false, true, Set.of(), userId);
    }

    public static DataScope depts(Set<Long> deptIds, Long userId) {
        return new DataScope(false, false, Set.copyOf(deptIds), userId);
    }
}
