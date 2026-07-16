package com.hentor.oa.common.fieldperm;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 字段权限·所属功能声明（P3）：标在响应 DTO record 类上，feature=功能键
 * （ai_feature_catalog.feature_code 的 opaque 字符串，拍板 A——system 侧不 join 目录）。
 * 类内 {@link FieldPerm} 标注的组件构成该功能的「可控固定列」。
 */
@Documented
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface FieldPermEntity {

    String feature();
}
