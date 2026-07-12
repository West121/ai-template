package com.xingchen.oa.office.support;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.CurrentUserHolder;
import com.xingchen.oa.common.security.DataScope;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.system.datadim.CriteriaScopes;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

/**
 * office 模块公共安全工具：当前用户上下文 + 数据权限 Specification。
 * 数据权限口径与 ApprovalService 既有实现一致：
 * all → 不过滤；selfOnly / 无部门范围 → user 字段 = 当前用户；
 * 否则 → dept 字段 IN 可见部门 OR user 字段 = 当前用户。
 */
public final class SecuritySupport {

    private SecuritySupport() {
    }

    public static UserContext currentUser() {
        UserContext context = CurrentUserHolder.get();
        if (context == null) {
            throw new BusinessException(401, "未登录或凭证已失效");
        }
        return context;
    }

    /**
     * 展示名：优先姓名，缺省回退用户名。
     */
    public static String displayName(UserContext context) {
        return StringUtils.hasText(context.getName()) ? context.getName() : context.getUsername();
    }

    /**
     * 按当前激活身份构建数据权限 Specification。
     *
     * @param deptField 实体上的部门字段名（如 "deptId"）
     * @param userField 实体上的归属人字段名（如 "applicantId" / "userId"）
     */
    public static <T> Specification<T> dataScope(String deptField, String userField) {
        DataScope scope = currentUser().getDataScope();
        return (root, query, cb) -> {
            if (scope == null || scope.all()) {
                return cb.conjunction();
            }
            if (scope.selfOnly() || scope.deptIds().isEmpty()) {
                return cb.equal(root.get(userField), scope.userId());
            }
            return cb.or(
                    CriteriaScopes.inOrAny(cb, root.get(deptField), scope.deptIds()),
                    cb.equal(root.get(userField), scope.userId()));
        };
    }
}
