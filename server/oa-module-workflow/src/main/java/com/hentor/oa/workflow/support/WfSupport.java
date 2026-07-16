package com.hentor.oa.workflow.support;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.CurrentUserHolder;
import com.hentor.oa.common.security.UserContext;
import org.springframework.util.StringUtils;

/** 工作流模块公共安全工具。 */
public final class WfSupport {

    private WfSupport() {
    }

    public static UserContext currentUser() {
        UserContext context = CurrentUserHolder.get();
        if (context == null) {
            throw new BusinessException(401, "未登录或凭证已失效");
        }
        return context;
    }

    public static String displayName(UserContext context) {
        return StringUtils.hasText(context.getName()) ? context.getName() : context.getUsername();
    }
}
