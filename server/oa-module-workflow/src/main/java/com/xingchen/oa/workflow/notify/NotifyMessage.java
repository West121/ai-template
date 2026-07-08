package com.xingchen.oa.workflow.notify;

/** 通知消息载体（渠道无关）。 */
public record NotifyMessage(Long userId, String type, String title, String content, String procInstId) {
}
