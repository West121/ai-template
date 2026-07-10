package com.xingchen.oa.office.init;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.engine.RepositoryService;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * 部署中国式公文办文流程 gw_send / gw_recv 到共享 Flowable 引擎。
 * 幂等：enableDuplicateFiltering() —— XML 内容不变则不产生新部署版本。
 * 复用平台单例 ProcessEngine（office 仅引入引擎库，不依赖 oa-module-workflow）。
 */
@Slf4j
@Component
@Order(120)
@RequiredArgsConstructor
public class GongwenInitializer implements ApplicationRunner {

    private static final String[] RESOURCES = {
            "processes/gw_send.bpmn20.xml",
            "processes/gw_recv.bpmn20.xml"
    };

    private final RepositoryService repositoryService;

    @Override
    public void run(ApplicationArguments args) {
        for (String path : RESOURCES) {
            try {
                String xml = read(path);
                repositoryService.createDeployment()
                        .name("gongwen")
                        .addString(path.substring(path.lastIndexOf('/') + 1), xml)
                        .enableDuplicateFiltering()
                        .deploy();
                log.info("公文流程初始化：已部署 {}", path);
            } catch (Exception e) {
                log.warn("公文流程初始化：部署 {} 失败: {}", path, e.getMessage());
            }
        }
    }

    private String read(String path) throws IOException {
        try (InputStream in = new ClassPathResource(path).getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
