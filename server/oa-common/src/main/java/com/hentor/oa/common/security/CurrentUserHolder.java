package com.hentor.oa.common.security;

/**
 * 请求级用户上下文持有器（ThreadLocal）。
 * 由 JwtAuthFilter 在请求开始时 set，请求结束（finally）时 clear。
 */
public final class CurrentUserHolder {

    private static final ThreadLocal<UserContext> HOLDER = new ThreadLocal<>();

    private CurrentUserHolder() {
    }

    public static void set(UserContext context) {
        HOLDER.set(context);
    }

    public static UserContext get() {
        return HOLDER.get();
    }

    public static void clear() {
        HOLDER.remove();
    }
}
