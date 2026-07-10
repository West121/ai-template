package com.xingchen.oa.infra.access;

import com.xingchen.oa.common.security.UserContext;

/**
 * 文件下载附加放行 SPI（B-17）。
 *
 * <p>B-04 收紧文件下载后，下载仅允许 <b>上传者本人 / 持 {@code system:file:list} / 数据权限 ALL</b>。
 * 副作用是 SELF 数据权限用户无法查看他人上传、但自己有权查看的业务对象所引用的文件
 * （典型：审批附件、电子章图片 → 裂图）。
 *
 * <p>本 SPI 让上层业务模块（如 workflow）以「文件被当前用户可合法查看的业务对象引用」为由，
 * 对特定文件补充放行。基础设施层只定义契约，具体判定由业务模块实现并注册为 Spring bean；
 * 依赖方向保持 {@code infra ← ... ← workflow}（业务模块向下依赖 infra，反向由 SPI 解耦）。
 *
 * <p>{@link com.xingchen.oa.infra.service.FileService} 在 owner / {@code system:file:list} /
 * 数据权限 ALL 判定之后，把所有 {@code FileAccessGrant} 作为兜底逐个询问，任一实现放行即可下载。
 */
public interface FileAccessGrant {

    /**
     * 判断当前用户是否可通过该业务维度下载指定文件。
     *
     * @param fileId 目标文件 id
     * @param user   当前登录用户上下文
     * @return true=放行下载；false=本维度不放行（交由其它 grant 或最终 403）
     */
    boolean canRead(Long fileId, UserContext user);
}
