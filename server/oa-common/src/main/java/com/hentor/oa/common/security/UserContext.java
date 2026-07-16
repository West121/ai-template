package com.hentor.oa.common.security;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 当前登录用户上下文：由 JwtAuthFilter 装配并放入 {@link CurrentUserHolder}，
 * 各业务模块在查询时读取 dataScope 做数据权限过滤。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserContext {

    private Long userId;

    private String username;

    private String name;

    /**
     * 功能权限（所有任职角色权限的并集），同时作为 Security authorities。
     */
    private List<String> permissions;

    /**
     * 当前激活身份："ALL" 表示全部身份并集，否则为任职 id 字符串。
     */
    private String activeAssignment;

    /**
     * 当前激活身份对应的部门 id（激活 "ALL" 时取主任职部门），用于新建单据默认归属。
     */
    private Long activeDeptId;

    /**
     * 按激活身份解析出的数据权限范围。
     */
    private DataScope dataScope;

    /**
     * 在线会话 id（由 JwtAuthFilter 从 token sid claim 填充；老 token 为 null）。用于「本人当前会话」标记 + 踢人护栏。
     */
    private String sessionId;
}
