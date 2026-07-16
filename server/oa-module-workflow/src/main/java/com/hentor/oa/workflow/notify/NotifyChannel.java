package com.hentor.oa.workflow.notify;

/**
 * 通知渠道 SPI。内置站内(wf_notify)+日志两实现；短信/邮件/微信/钉钉留扩展点：
 * 新增渠道只需实现本接口并注册为 Spring bean，{@link NotifyDispatcher} 会自动纳入分发。
 */
public interface NotifyChannel {

    /** 渠道标识（STATION / LOG / SMS / EMAIL / WECHAT / DINGTALK ...）。 */
    String type();

    /** 是否启用（默认启用，扩展渠道可按配置开关）。 */
    default boolean enabled() {
        return true;
    }

    void send(NotifyMessage message);
}
