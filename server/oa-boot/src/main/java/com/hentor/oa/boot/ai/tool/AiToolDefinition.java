package com.hentor.oa.boot.ai.tool;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * AI 助手工具声明 V2（ai-assistant-design-v2.md §6.2，批B 替换 {@code @AiTool}）：
 * 方法签名统一 {@code ToolResult method(Map<String,Object> args)}，实现内一律包装既有 Service
 * （@PreAuthorize 功能权限与 JPA 数据权限二次生效——工具层过滤只是第一道门）。
 *
 * <p>暴露与执行策略：{@link AuthorizedToolResolver} 按 authorities/risk/开关过滤后才把工具给模型；
 * {@link AiToolGateway} 执行时再验权限 + 参数 Schema + 超时 + 结果最小化 + 审计（risk 真实落库）。
 * name 为 §6.4 对齐的规范名（OpenAI function 名约束 [a-zA-Z0-9_-]，点号以下划线代替）；
 * aliases 兼容旧名（模型/历史会话按旧名调用时经 Gateway 别名解析执行，不出现在暴露列表）。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface AiToolDefinition {

    /** 规范工具名（§6.4 命名，下划线代点）。 */
    String name();

    /** 一句话功能描述（给 LLM 的使用说明）。 */
    String description();

    /** OpenAI parameters.properties JSON（如 {"keyword":{"type":"string","description":"..."}}）。 */
    String paramsSchema() default "{}";

    /** 必填参数名列表（Gateway 执行前校验）。 */
    String[] required() default {};

    /** 功能权限码（全部满足才暴露给模型；执行时 Gateway 复验）。空=登录即可。 */
    String[] authorities() default {};

    /** 风险等级（§7.1）；PROHIBITED 不暴露不执行。 */
    AiToolRisk risk() default AiToolRisk.READ_ONLY;

    /** 单次执行超时（秒），超时返回 AI_TOOL_TIMEOUT 错误帧。 */
    int timeoutSeconds() default 15;

    /** 旧名兼容别名（V1 工具名；仅执行期解析，不暴露给模型）。 */
    String[] aliases() default {};
}
