package com.hentor.oa.workflow.service;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.workflow.dto.NotifyItem;
import com.hentor.oa.workflow.entity.WfNotify;
import com.hentor.oa.workflow.repository.WfNotifyRepository;
import com.hentor.oa.workflow.support.WfSupport;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class NotifyService {

    private final WfNotifyRepository repository;

    public PageResult<NotifyItem> page(int pageNum, int pageSize) {
        Long uid = WfSupport.currentUser().getUserId();
        Page<WfNotify> page = repository.findByUserId(uid,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        return new PageResult<>(page.getContent().stream().map(NotifyItem::of).toList(),
                page.getTotalElements(), pageNum, pageSize);
    }

    public long unreadCount() {
        return repository.countByUserIdAndReadFlagFalse(WfSupport.currentUser().getUserId());
    }

    @Transactional
    public void read(Long id) {
        Long uid = WfSupport.currentUser().getUserId();
        repository.findById(id)
                .filter(n -> n.getUserId().equals(uid))
                .ifPresent(n -> {
                    n.setReadFlag(true);
                    repository.save(n);
                });
    }

    @Transactional
    public void readAll() {
        Long uid = WfSupport.currentUser().getUserId();
        List<WfNotify> rows = repository.findByUserIdAndReadFlagFalse(uid);
        rows.forEach(n -> n.setReadFlag(true));
        repository.saveAll(rows);
    }
}
