package com.hentor.oa.boot.ai.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 存量 dataURL 附件清洗 runner（批D §17）：启动执行一次——把历史消息内联 dataURL 抽到 FileService、
 * 改存 attachmentId 引用（幂等，已引用化跳过）。失败不阻断启动。晚于其它恢复 runner（Order 20）。
 */
@Slf4j
@Component
@Order(20)
@RequiredArgsConstructor
public class AiAttachmentCleanupRunner implements ApplicationRunner {

    private final AiAttachmentService attachmentService;

    @Override
    public void run(ApplicationArguments args) {
        try {
            Map<String, Object> r = attachmentService.cleanLegacy();
            log.info("AI 存量 dataURL 附件清洗：扫描 {} 条消息，清洗 {} 个内联附件 → fileId 引用",
                    r.get("scanned"), r.get("cleaned"));
        } catch (Exception e) {
            log.warn("AI 存量 dataURL 附件清洗失败（不阻断启动）: {}", e.getMessage());
        }
    }
}
