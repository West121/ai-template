package com.xingchen.oa.workflow.orch.engine;

import org.springframework.beans.BeansException;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationContextAware;
import org.springframework.stereotype.Component;

/**
 * 静态 Spring 上下文入口：编排 LiteFlow 组件由 LiteFlow 反射实例化（非 Spring bean），
 * 经此获取平台服务（模板/脚本/仓库/HTTP 等）。仅编排组件使用。
 */
@Component
public class OrchSpringHolder implements ApplicationContextAware {

    private static ApplicationContext context;

    @Override
    public void setApplicationContext(ApplicationContext applicationContext) throws BeansException {
        context = applicationContext;
        // LiteFlow 的 Spring SPI（liteflow-spring 的 SpringAware）在 classpath 上会被 SPI 选中，
        // 但 liteflow.enable=false 时 starter 不注入上下文 → 编程式 FlowExecutor 组件注册 NPE。
        // 这里手动喂给它（幂等），使组件经 Spring registerOrGet 实例化（可用自动注入）。
        new com.yomahub.liteflow.spi.spring.SpringAware().setApplicationContext(applicationContext);
    }

    public static <T> T bean(Class<T> type) {
        if (context == null) {
            throw new IllegalStateException("Spring 上下文未就绪");
        }
        return context.getBean(type);
    }
}
