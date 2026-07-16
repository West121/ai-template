package com.hentor.oa.boot.ai.support;

import com.hentor.oa.common.exception.BusinessException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

/**
 * AI 助手错误码表（ai-assistant-design-v2.md §22），落 {@link BusinessException} code 体系：
 * 数值 code 沿用平台 HTTP 语义（400/403/404/409/410/429/503），字符串码以 {@code 前缀: } 形式并入 message，
 * 前端/smoke 可按 message 前缀断言具体错误类型（R 信封 {code,message,data} 不变）。
 */
public final class AiErrors {

    // ---- §22 错误码（字符串码） ----
    public static final String SESSION_NOT_FOUND = "AI_SESSION_NOT_FOUND";
    public static final String SESSION_BUSY = "AI_SESSION_BUSY";
    public static final String MESSAGE_DUPLICATE = "AI_MESSAGE_DUPLICATE";
    public static final String MODEL_UNAVAILABLE = "AI_MODEL_UNAVAILABLE";
    public static final String MODEL_NOT_ALLOWED = "AI_MODEL_NOT_ALLOWED";
    public static final String QUOTA_EXCEEDED = "AI_QUOTA_EXCEEDED";
    public static final String TOOL_NOT_ALLOWED = "AI_TOOL_NOT_ALLOWED";
    public static final String TOOL_TIMEOUT = "AI_TOOL_TIMEOUT";
    public static final String TOOL_INVALID_ARGUMENT = "AI_TOOL_INVALID_ARGUMENT";
    public static final String DATA_SCOPE_DENIED = "AI_DATA_SCOPE_DENIED";
    public static final String ACTION_NOT_FOUND = "AI_ACTION_NOT_FOUND";
    public static final String ACTION_EXPIRED = "AI_ACTION_EXPIRED";
    public static final String ACTION_ALREADY_EXECUTED = "AI_ACTION_ALREADY_EXECUTED";
    public static final String ACTION_STALE = "AI_ACTION_STALE";
    public static final String ACTION_CONFIRM_REQUIRED = "AI_ACTION_CONFIRM_REQUIRED";
    public static final String ATTACHMENT_NOT_SUPPORTED = "AI_ATTACHMENT_NOT_SUPPORTED";
    public static final String ATTACHMENT_TOO_LARGE = "AI_ATTACHMENT_TOO_LARGE";
    public static final String RAG_NO_RESULT = "AI_RAG_NO_RESULT";
    /** 附2 第 2 条：异步执行上下文缺失，工具入口断言拒绝执行。 */
    public static final String CONTEXT_MISSING = "AI_CONTEXT_MISSING";

    /** 租户预留常量（附1 裁定）。 */
    public static final String TENANT_DEFAULT = "default";

    private AiErrors() {
    }

    /** 构造带字符串码前缀的业务异常：message = "{stringCode}: {人话说明}"。 */
    public static BusinessException e(int httpCode, String stringCode, String message) {
        return new BusinessException(httpCode, stringCode + ": " + message);
    }

    /** SHA-256 hex（payload/参数哈希审计用）。 */
    public static String sha256(String text) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(
                    (text == null ? "" : text).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception ex) {
            return "";
        }
    }
}
