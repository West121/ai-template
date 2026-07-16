package com.hentor.oa.office.support;

import com.hentor.oa.common.security.CurrentUserHolder;
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
     * V51 缺口①闭环：按实体读 {@code sys_dimension_binding}（进程内缓存+写路径主动清）拼多维谓词——
     * 绑定升格为真元数据消费，调用方不再硬传列映射（原 ApprovalService.DATA_DIMENSIONS 常量已废除）。
     * 实体无绑定 → 退化纯部门维（向后兼容红线）。
     *
     * @param entity    可绑列目录内的实体名（如 Approval）
     * @param deptField 部门字段（如 deptId）
     * @param userField 归属人字段（如 applicantId / creatorId）
     */
    public <T> Specification<T> multiDim(String entity, String deptField, String userField) {
        return multiDim(deptField, userField, dataDimensionService.bindingsForEntity(entity));
    }

    /**
     * V54 功能级：各维度 <b>功能覆盖 &gt; 全局 &gt; 不限</b>（覆盖=替换，拍板 C）。
     * 内建 dept 覆盖存在时<b>替换</b>全局五档——ALL=不限；CUSTOM=(deptField IN 精确部门集) OR userField=self
     * （与全局档同构：自己的单据恒可见；<b>不含子树</b>——值链路与业务维一致、部门结构变更零失效面，
     * 要含子树请在前端选择器把子部门勾进显式 id 集）。dept 无覆盖 → 回落 role.dataScope 全局五档。
     */
    public <T> Specification<T> multiDim(String feature, String entity, String deptField, String userField) {
        DimensionScope deptOverride = dataDimensionService.deptOverride(feature);
        Specification<T> spec = deptOverride == null
                ? SecuritySupport.dataScope(deptField, userField)
                : deptOverrideSpec(deptOverride, deptField, userField);
        Map<String, String> dimColumns = dataDimensionService.bindingsForEntity(entity);
        if (dimColumns.isEmpty()) {
            return spec;
        }
        Map<String, DimensionScope> scopes = dataDimensionService.resolveForCurrentUser(feature, dimColumns.keySet());
        for (Map.Entry<String, String> binding : dimColumns.entrySet()) {
            DimensionScope scope = scopes.get(binding.getKey());
            if (scope == null || scope.all()) {
                continue; // 未配/ALL → 该维不限
            }
            String column = binding.getValue();
            Set<Long> values = scope.values();
            spec = spec.and((root, query, cb) -> CriteriaScopes.inOrAny(cb, root.get(column), values));
        }
        return spec;
    }

    /** dept 覆盖谓词（替换全局五档，语义见 multiDim javadoc）。 */
    private <T> Specification<T> deptOverrideSpec(DimensionScope s, String deptField, String userField) {
        return (root, query, cb) -> {
            if (s.all()) {
                return cb.conjunction();
            }
            Long uid = CurrentUserHolder.get() != null ? CurrentUserHolder.get().getUserId() : null;
            if (s.values().isEmpty()) {
                return cb.equal(root.get(userField), uid); // 空集=仅本人（默认更严）
            }
            return cb.or(CriteriaScopes.inOrAny(cb, root.get(deptField), s.values()),
                    cb.equal(root.get(userField), uid));
        };
    }

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
