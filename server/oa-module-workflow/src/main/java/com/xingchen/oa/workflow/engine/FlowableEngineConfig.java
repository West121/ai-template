package com.xingchen.oa.workflow.engine;

import lombok.RequiredArgsConstructor;
import org.flowable.spring.SpringProcessEngineConfiguration;
import org.flowable.spring.boot.ProcessEngineConfigurationConfigurer;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.util.List;

/**
 * Flowable 引擎装配收尾：复用 Spring Boot starter 自动装配的 {@link SpringProcessEngineConfiguration}
 * （共享平台 DataSource + 事务管理器），仅追加平台自定义全局事件监听器。
 * databaseSchemaUpdate / asyncExecutorActivate 等经 application.yml 的 flowable.* 配置。
 */
@Configuration
@EnableScheduling
@RequiredArgsConstructor
public class FlowableEngineConfig implements ProcessEngineConfigurationConfigurer {

    private final WfEngineEventListener wfEngineEventListener;
    private final com.xingchen.oa.workflow.orch.engine.OrchEventBridge orchEventBridge;

    @Override
    public void configure(SpringProcessEngineConfiguration engineConfiguration) {
        engineConfiguration.setEventListeners(List.of(wfEngineEventListener, orchEventBridge));
    }
}
