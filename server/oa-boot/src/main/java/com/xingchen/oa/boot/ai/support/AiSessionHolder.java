package com.xingchen.oa.boot.ai.support;

import org.springframework.stereotype.Component;

/**
 * 当前 AI 轮次上下文的 ThreadLocal 持有（sessionId/assistantMessageId/requestId/traceId）：
 * 变更工具暂存动作草稿时绑定 session/message；工具审计（ai_tool_call）取关联标识。
 * V2 起 agent 循环可能在异步工作线程执行——由 executeTurn 入口显式 set、finally clear
 * （工作线程上下文经 {@link AiExecutionContext} 装饰器传播，本 holder 由轮次入口自行装入）。
 */
@Component
public class AiSessionHolder {

    /** 轮次上下文（会话/助手消息/关联标识）。 */
    public record Turn(Long sessionId, Long messageId, String requestId, String traceId) {
    }

    private static final ThreadLocal<Turn> TURN = new ThreadLocal<>();

    public void set(Long sessionId) {
        TURN.set(new Turn(sessionId, null, null, null));
    }

    public void set(Long sessionId, Long messageId, String requestId, String traceId) {
        TURN.set(new Turn(sessionId, messageId, requestId, traceId));
    }

    public Long currentSessionId() {
        Turn t = TURN.get();
        return t == null ? null : t.sessionId();
    }

    public Turn currentTurn() {
        return TURN.get();
    }

    public void clear() {
        TURN.remove();
    }
}
