package com.xingchen.oa.workflow.notify;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;

/** 通知分发：向所有启用渠道投递（内置站内 + 日志，扩展渠道自动纳入）。 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NotifyDispatcher {

    private final List<NotifyChannel> channels;

    public void dispatch(NotifyMessage message) {
        for (NotifyChannel ch : channels) {
            if (!ch.enabled()) {
                continue;
            }
            try {
                ch.send(message);
            } catch (Exception e) {
                log.warn("通知渠道 {} 投递失败: {}", ch.type(), e.getMessage());
            }
        }
    }
}
