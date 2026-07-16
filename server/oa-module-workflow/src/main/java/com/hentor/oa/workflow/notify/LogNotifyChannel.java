package com.hentor.oa.workflow.notify;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/** 内置日志通知渠道：便于开发期追踪 + 作为外部渠道（短信/邮件…）的兜底示例。 */
@Slf4j
@Component
public class LogNotifyChannel implements NotifyChannel {

    @Override
    public String type() {
        return "LOG";
    }

    @Override
    public void send(NotifyMessage m) {
        log.info("[wf-notify][{}] to={} title={} pid={}", m.type(), m.userId(), m.title(), m.procInstId());
    }

    // 扩展点示例：短信/邮件/微信/钉钉渠道实现 NotifyChannel 并注册为 bean 即可自动纳入分发。
    // @Component class SmsNotifyChannel implements NotifyChannel { ... }
}
