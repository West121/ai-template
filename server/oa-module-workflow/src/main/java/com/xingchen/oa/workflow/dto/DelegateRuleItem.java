package com.xingchen.oa.workflow.dto;

import com.xingchen.oa.workflow.entity.WfDelegateRule;

import java.time.LocalDate;
import java.time.OffsetDateTime;

public record DelegateRuleItem(
        Long id,
        Long ownerId,
        Long delegateToId,
        String delegateToName,
        String defCode,
        LocalDate startDate,
        LocalDate endDate,
        Boolean enabled,
        OffsetDateTime createdAt) {

    public static DelegateRuleItem of(WfDelegateRule r, String delegateToName) {
        return new DelegateRuleItem(r.getId(), r.getOwnerId(), r.getDelegateToId(), delegateToName,
                r.getDefCode(), r.getStartDate(), r.getEndDate(), r.getEnabled(), r.getCreatedAt());
    }
}
