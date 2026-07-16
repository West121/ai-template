package com.hentor.oa.common.fieldperm;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 字段权限·可控固定列标注（权限中心 P3，设计稿附2 拍板）：标在响应 DTO record 组件上，
 * 声明「此列可被角色×功能字段权限控制」。启动反射扫描（{@code FieldPermCatalogService}）
 * 生成可控列目录进配置矩阵——<b>只有标注解的列才可控（天然白名单，不假装能控）</b>；
 * 清单与 DTO 同文件防漂移。visible=false 时该列在响应中置 null（{@link FieldPermMasker}）。
 *
 * <p>所在 record 须同时标 {@link FieldPermEntity} 声明所属功能（feature）。
 */
@Documented
@Target(ElementType.RECORD_COMPONENT)
@Retention(RetentionPolicy.RUNTIME)
public @interface FieldPerm {

    /** 人话列名（配置矩阵展示）。 */
    String label();
}
