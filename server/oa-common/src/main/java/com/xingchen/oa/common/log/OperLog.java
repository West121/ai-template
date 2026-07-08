package com.xingchen.oa.common.log;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 操作日志注解：标注在关键写接口上，由 oa-module-infra 的 AOP 切面统一落库
 * （成功 / 异常均记录：参数 JSON、耗时、IP、操作人，异常继续抛出）。
 */
@Documented
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface OperLog {

    /** 业务模块名，如 "审批" / "用户" / "文件" */
    String module();

    /** 动作名，如 "创建" / "同意" / "删除" */
    String action();
}
