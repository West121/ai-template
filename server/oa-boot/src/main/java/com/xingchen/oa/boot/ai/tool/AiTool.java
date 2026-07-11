package com.xingchen.oa.boot.ai.tool;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * AI 助手工具声明（方法级，§4 ToolRegistry 注册机制）：
 * 方法签名统一 {@code ToolResult method(Map<String,Object> args)}，实现内一律包装既有 Service
 * （UserContext 从请求线程 ThreadLocal 生效——助手 agent 循环在请求线程同步执行，安全红线 §0.1）。
 * paramsSchema 为 OpenAI function parameters 的 properties JSON（手写，精确可控）。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface AiTool {

    /** 工具名（LLM function name）。 */
    String name();

    /** 一句话功能描述（给 LLM 的使用说明）。 */
    String description();

    /** OpenAI parameters.properties JSON（如 {"keyword":{"type":"string","description":"..."}}）。 */
    String paramsSchema() default "{}";

    /** 必填参数名列表。 */
    String[] required() default {};
}
