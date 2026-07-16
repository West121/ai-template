package com.hentor.oa.boot.ai.support;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * AI 助手异步执行器（SSE 轮次执行）：Java 21 虚拟线程 per-task——LLM 循环为 IO 密集长阻塞（≤60s），
 * 虚拟线程免线程池容量调优。任务必须经 {@link AiExecutionContext#wrap} 装饰提交
 * （UserContext/SecurityContext/MDC 显式传播，附2 第 2 条）。
 */
@Configuration
public class AiAsyncConfig {

    @Bean(name = "aiExecutor", destroyMethod = "shutdown")
    public ExecutorService aiExecutor() {
        return Executors.newVirtualThreadPerTaskExecutor();
    }
}
