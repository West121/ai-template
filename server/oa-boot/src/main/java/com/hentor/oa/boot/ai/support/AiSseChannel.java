package com.hentor.oa.boot.ai.support;

import lombok.extern.slf4j.Slf4j;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * SSE 事件通道（ai-assistant-design-v2.md §9.2）：包裹 {@link SseEmitter}，
 * 事件 JSON {@code {sessionId,messageId,sequence,type,timestamp,payload}}，sequence 单调递增。
 * 发送失败（客户端断连/超时）静默降级——业务照常完成落库，仅推送失效。
 */
@Slf4j
public class AiSseChannel {

    public static final String EV_MESSAGE_STARTED = "message.started";
    public static final String EV_TOOL_STARTED = "tool.started";
    public static final String EV_TOOL_COMPLETED = "tool.completed";
    public static final String EV_TOOL_FAILED = "tool.failed";
    public static final String EV_PART_CREATED = "message.part.created";
    public static final String EV_MESSAGE_COMPLETED = "message.completed";
    public static final String EV_MESSAGE_FAILED = "message.failed";

    private final SseEmitter emitter;
    private final ObjectMapper objectMapper;
    private final AtomicInteger sequence = new AtomicInteger(0);
    private final AtomicBoolean dead = new AtomicBoolean(false);

    private Long sessionId;
    private Long messageId;

    public AiSseChannel(SseEmitter emitter, ObjectMapper objectMapper) {
        this.emitter = emitter;
        this.objectMapper = objectMapper;
        emitter.onTimeout(() -> dead.set(true));
        emitter.onCompletion(() -> dead.set(true));
        emitter.onError(e -> dead.set(true));
    }

    public void bind(Long sessionId, Long messageId) {
        this.sessionId = sessionId;
        this.messageId = messageId;
    }

    /** 发送一个协议事件（sequence 自增）；通道失效时 no-op。 */
    public void send(String type, Map<String, Object> payload) {
        if (dead.get()) {
            return;
        }
        try {
            Map<String, Object> event = new LinkedHashMap<>();
            event.put("sessionId", sessionId);
            event.put("messageId", messageId);
            event.put("sequence", sequence.incrementAndGet());
            event.put("type", type);
            event.put("timestamp", OffsetDateTime.now().toString());
            event.put("payload", payload == null ? Map.of() : payload);
            emitter.send(SseEmitter.event().name(type).data(objectMapper.writeValueAsString(event)));
        } catch (Exception ex) {
            dead.set(true);
            log.debug("SSE 事件发送失败（客户端可能已断开）: {}", ex.getMessage());
        }
    }

    public void complete() {
        if (dead.compareAndSet(false, true)) {
            try {
                emitter.complete();
            } catch (Exception ignored) {
                // 已断开
            }
        }
    }
}
