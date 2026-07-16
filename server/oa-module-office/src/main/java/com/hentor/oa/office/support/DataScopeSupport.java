package com.hentor.oa.office.support;

import com.hentor.oa.system.datadim.CriteriaScopes;
import com.hentor.oa.system.datadim.DataDimensionService;
import com.hentor.oa.system.datadim.DimensionScope;
import lombok.RequiredArgsConstructor;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;

/**
 * 多维数据权限 Specification 构造（DP1）：内建<b>部门维</b>（{@link SecuritySupport#dataScope} 既有 5 档行为，
 * 向后兼容）<b>AND</b> 各业务维度（costCenter/project…；CUSTOM 时 {@code col IN (可见集)}，维度间 AND）。
 *
 * <p>向后兼容红线：{@code dimColumns} 为空 → 完全退化为纯部门维（现有实体行为不变）。业务维仅在用户
 * <b>配置了 CUSTOM</b> 时才加谓词（未配/ALL=不限）。可见集来自 {@link DataDimensionService} 的 Redis 预计算缓存
 * （查询侧不 join 授权表、不递归）。
 */
@Component
@RequiredArgsConstructor
public class DataScopeSupport {

    private final DataDimensionService dataDimensionService;

    /**
     * @param deptField  部门字段（如 deptId）
     * @param userField  归属人字段（如 applicantId / creatorId）
     * @param dimColumns 业务维度 code → 实体列名（如 {@code {costCenter:"costCenterId", project:"projectId"}}），可空
     */
    public <T> Specification<T> multiDim(String deptField, String userField, Map<String, String> dimColumns) {
        Specification<T> spec = SecuritySupport.dataScope(deptField, userField);
        if (dimColumns == null || dimColumns.isEmpty()) {
            return spec;
        }
        Map<String, DimensionScope> scopes = dataDimensionService.resolveForCurrentUser(dimColumns.keySet());
        for (Map.Entry<String, String> binding : dimColumns.entrySet()) {
            DimensionScope scope = scopes.get(binding.getKey());
            if (scope == null || scope.all()) {
                continue; // 未配/ALL → 该维不限，不加谓词（短路）
            }
            String column = binding.getValue();
            Set<Long> values = scope.values();
            // CUSTOM：col IN (可见集)（DP1b：超大集自动切 = ANY(array)）；空集合 → 什么都看不到（默认更严）
            spec = spec.and((root, query, cb) -> CriteriaScopes.inOrAny(cb, root.get(column), values));
        }
        return spec;
    }
}
