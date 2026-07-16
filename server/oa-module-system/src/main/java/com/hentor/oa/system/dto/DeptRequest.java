package com.hentor.oa.system.dto;

/**
 * 部门新增/修改请求。
 * 新增：name 必填（服务层校验）；修改为部分更新——仅更新请求中非 null 的字段，
 * 其中 leaderId = 0 表示清空负责人，code 传空串表示清空编码。
 */
public record DeptRequest(
        String name,
        Long parentId,
        Integer sort,
        String code,
        Long leaderId,
        Boolean enabled
) {
}
