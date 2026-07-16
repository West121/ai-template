package com.hentor.oa.common.script;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 脚本 API 白名单标注：标在<b>允许推荐给脚本调用</b>的 Service/门面类（或其方法补说明）上，
 * 启动时被 workflow 的 ScriptManifestService 扫描（{@code getBeansWithAnnotation}），
 * 反射枚举 public 方法签名进「脚本上下文清单」（{@code GET /api/wf/script/context-manifest}），
 * 供前端脚本编辑器（CodeMirror）做代码提示。
 *
 * <p><b>清单 ≠ 沙箱（别误解）</b>：受信脚本本就全权——{@code spring.bean(...)} 可达整个容器，
 * 未标注的 bean 依然可被脚本调用。本注解只管「编辑器提示什么」（规范限定的推荐面），
 * <b>不是运行时权限边界</b>；运行时治理仍靠 {@code wf:script:write} 门槛 + 执行审计。
 */
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface ScriptApi {

    /** 一句话说明（类=该 API 门面用途；方法=该方法用途，进清单 doc 字段）。 */
    String value() default "";
}
