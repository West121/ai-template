package com.xingchen.oa.workflow.engine.ai;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI 审批配置（P3）：{@code oa.ai.*}。默认 enabled=false → AI 节点走规则模拟并在意见明示「AI模拟」。
 * 启用时 baseUrl 指向 OpenAI 兼容 / Claude 的 chat completions 网关，apiKey 为鉴权密钥。
 * 由 {@code @ConfigurationPropertiesScan} 注册为 bean（勿加 @Component 以免重复注册）。
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "oa.ai")
public class OaAiProperties {

    /** 是否启用真实 AI 调用；false 时降级为规则模拟。 */
    private boolean enabled = false;

    /** OpenAI 兼容 chat completions 基址（如 https://api.openai.com/v1 或自建网关）。 */
    private String baseUrl = "https://api.openai.com/v1";

    /** 鉴权密钥；为空即视为未配置，降级模拟。 */
    private String apiKey = "";

    /** 默认模型（节点未指定 model 时用）。 */
    private String model = "gpt-4o-mini";

    /** 请求超时秒。 */
    private int timeoutSeconds = 20;
}
