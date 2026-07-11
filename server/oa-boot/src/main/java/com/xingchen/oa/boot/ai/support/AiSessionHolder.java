package com.xingchen.oa.boot.ai.support;

import org.springframework.stereotype.Component;

/**
 * 当前会话 id 的 ThreadLocal 持有（chat 请求线程内设置）：变更工具暂存动作时把 confirm 绑定到 session。
 * agent 循环在请求线程同步执行，无需跨线程传播（安全红线 §0.1：UserContext 也因此天然生效）。
 */
@Component
public class AiSessionHolder {

    private static final ThreadLocal<Long> SESSION = new ThreadLocal<>();

    public void set(Long sessionId) {
        SESSION.set(sessionId);
    }

    public Long currentSessionId() {
        return SESSION.get();
    }

    public void clear() {
        SESSION.remove();
    }
}
