package com.xingchen.oa.system.datadim;

import java.util.List;

/**
 * 数据维度提供者（可插拔 SPI）。每个业务数据维度实现一个 provider bean，负责提供该维度 CUSTOM 授权时
 * 的可选值列表。<b>新维度 = 新增一个 provider bean + 一行 {@code sys_data_dimension} 元数据 + 实体加列</b>，
 * 不改 AI / 查询核心。
 *
 * <p>Provider 可存在于任意业务模块（业务模块单向依赖 oa-module-system，故可实现本接口）；
 * {@code DataDimensionService} 通过注入 {@code List<DataDimensionProvider>} 收集全部实现，按 {@link #code()} 分发。
 *
 * <p>内建 dept / self 维度不走本 SPI（dept 仍走既有 5 档 {@code role.dataScope} → JWT DataScope，向后兼容）。
 */
public interface DataDimensionProvider {

    /** 维度编码（与 {@code sys_data_dimension.code} 对应，全局唯一）。 */
    String code();

    /** 该维度 CUSTOM 授权时的可选值（id + 展示名）。 */
    List<DimensionOption> options();
}
