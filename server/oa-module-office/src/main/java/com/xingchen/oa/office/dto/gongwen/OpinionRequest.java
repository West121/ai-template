package com.xingchen.oa.office.dto.gongwen;

/**
 * 提交办文意见并办理当前节点。decision：APPROVE 同意 / REJECT 退回 / TRANSFER 转办（缺省 APPROVE）。
 * TRANSFER 时须给 targetUserId（转办给谁）。
 */
public record OpinionRequest(
        String opinion,
        String decision,
        Long targetUserId
) {
}
