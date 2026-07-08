package com.xingchen.oa.system.dto;

import com.xingchen.oa.system.entity.SysPost;

public record PostResponse(
        Long id,
        String code,
        String name,
        Integer sort,
        long userCount
) {
    public static PostResponse of(SysPost post, long userCount) {
        return new PostResponse(post.getId(), post.getCode(), post.getName(), post.getSort(), userCount);
    }
}
