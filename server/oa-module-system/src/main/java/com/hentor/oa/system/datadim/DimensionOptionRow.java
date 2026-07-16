package com.hentor.oa.system.datadim;

/**
 * 维度选项管理行（{@code /data-dimensions/{code}/option-items}，管理视图含禁用行）。
 * 注意与授权侧 {@link DimensionOption}（{id=授权值,label}，仅启用）区分：本行 id=行主键（编辑/删除用）。
 */
public record DimensionOptionRow(Long id, Long value, String label, Integer sort, Boolean enabled) {
}
