package com.xingchen.oa.workflow.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.workflow.dto.DelegateRuleItem;
import com.xingchen.oa.workflow.dto.P2Requests.DelegateRuleRequest;
import com.xingchen.oa.workflow.entity.WfDelegateRule;
import com.xingchen.oa.workflow.repository.WfDelegateRuleRepository;
import com.xingchen.oa.workflow.support.UserNameResolver;
import com.xingchen.oa.workflow.support.WfSupport;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.util.List;
import java.util.Objects;

/**
 * 委托规则（代理预设）CRUD：owner=当前用户，命中时任务创建自动给受托人挂 candidate（见 WfEngineEventListener）。
 */
@Service
@RequiredArgsConstructor
public class DelegateRuleService {

    private final WfDelegateRuleRepository repository;
    private final UserNameResolver nameResolver;

    public List<DelegateRuleItem> list() {
        Long uid = WfSupport.currentUser().getUserId();
        return repository.findByOwnerIdOrderByIdDesc(uid).stream()
                .map(r -> DelegateRuleItem.of(r, nameResolver.name(r.getDelegateToId())))
                .toList();
    }

    @Transactional
    public DelegateRuleItem create(DelegateRuleRequest req) {
        UserContext ctx = WfSupport.currentUser();
        if (req.delegateToId() == null) {
            throw new BusinessException(400, "受托人不能为空");
        }
        if (Objects.equals(req.delegateToId(), ctx.getUserId())) {
            throw new BusinessException(400, "不能把任务委托给自己");
        }
        WfDelegateRule r = new WfDelegateRule();
        r.setOwnerId(ctx.getUserId());
        r.setDelegateToId(req.delegateToId());
        r.setDefCode(StringUtils.hasText(req.defCode()) ? req.defCode() : null);
        r.setStartDate(parseDate(req.startDate()));
        r.setEndDate(parseDate(req.endDate()));
        r.setEnabled(req.enabled() == null ? Boolean.TRUE : req.enabled());
        return DelegateRuleItem.of(repository.save(r), nameResolver.name(r.getDelegateToId()));
    }

    @Transactional
    public void delete(Long id) {
        Long uid = WfSupport.currentUser().getUserId();
        repository.findById(id)
                .filter(r -> Objects.equals(r.getOwnerId(), uid))
                .ifPresent(repository::delete);
    }

    private LocalDate parseDate(String s) {
        if (!StringUtils.hasText(s)) {
            return null;
        }
        try {
            return LocalDate.parse(s.trim());
        } catch (Exception e) {
            throw new BusinessException(400, "日期格式错误（yyyy-MM-dd）：" + s);
        }
    }
}
