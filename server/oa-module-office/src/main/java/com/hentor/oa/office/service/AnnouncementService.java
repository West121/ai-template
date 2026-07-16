package com.hentor.oa.office.service;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.office.dto.AnnouncementCreateRequest;
import com.hentor.oa.office.dto.AnnouncementResponse;
import com.hentor.oa.office.entity.Announcement;
import com.hentor.oa.office.entity.AnnouncementRead;
import com.hentor.oa.office.repository.AnnouncementReadRepository;
import com.hentor.oa.office.repository.AnnouncementRepository;
import com.hentor.oa.office.support.DeptNameResolver;
import com.hentor.oa.office.support.SecuritySupport;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class AnnouncementService {

    private final AnnouncementRepository announcementRepository;
    private final AnnouncementReadRepository readRepository;
    private final DeptNameResolver deptNameResolver;

    /**
     * 公告列表（全员可见）：置顶优先，再按发布时间倒序；附当前用户已读标记。
     */
    public PageResult<AnnouncementResponse> page(String category, int pageNum, int pageSize) {
        Long userId = SecuritySupport.currentUser().getUserId();
        Pageable pageable = PageRequest.of(Math.max(pageNum - 1, 0), pageSize,
                Sort.by(Sort.Order.desc("top"), Sort.Order.desc("publishAt")));
        Page<Announcement> page = StringUtils.hasText(category)
                ? announcementRepository.findByCategory(category, pageable)
                : announcementRepository.findAll(pageable);
        Set<Long> readIds = readRepository.findByUserId(userId).stream()
                .map(AnnouncementRead::getAnnouncementId)
                .collect(Collectors.toSet());
        Map<Long, String> deptNames = deptNameResolver.nameMap();
        List<AnnouncementResponse> list = page.getContent().stream()
                .map(a -> toResponse(a, deptNames, readIds.contains(a.getId())))
                .toList();
        return new PageResult<>(list, page.getTotalElements(), page.getNumber() + 1, page.getSize());
    }

    public long unreadCount() {
        Long userId = SecuritySupport.currentUser().getUserId();
        return Math.max(announcementRepository.count() - readRepository.countByUserId(userId), 0);
    }

    @Transactional
    public AnnouncementResponse create(AnnouncementCreateRequest request) {
        UserContext context = SecuritySupport.currentUser();
        Announcement announcement = new Announcement();
        announcement.setCategory(request.category());
        announcement.setTitle(request.title());
        announcement.setContent(request.content());
        announcement.setPublisher(SecuritySupport.displayName(context));
        announcement.setPublisherId(context.getUserId());
        announcement.setDeptId(context.getActiveDeptId());
        announcement.setTop(Boolean.TRUE.equals(request.top()));
        announcement.setReads(0);
        announcement.setPublishAt(LocalDateTime.now());
        Announcement saved = announcementRepository.save(announcement);
        return toResponse(saved, deptNameResolver.nameMap(), false);
    }

    /**
     * 标记已读：幂等，仅首次已读时 reads + 1。
     */
    @Transactional
    public void read(Long id) {
        Long userId = SecuritySupport.currentUser().getUserId();
        Announcement announcement = announcementRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "公告不存在"));
        if (readRepository.existsByAnnouncementIdAndUserId(id, userId)) {
            return;
        }
        AnnouncementRead read = new AnnouncementRead();
        read.setAnnouncementId(id);
        read.setUserId(userId);
        readRepository.save(read);
        announcement.setReads(announcement.getReads() + 1);
        announcementRepository.save(announcement);
    }

    private AnnouncementResponse toResponse(Announcement a, Map<Long, String> deptNames, boolean readFlag) {
        return new AnnouncementResponse(
                a.getId(), a.getCategory(), a.getTitle(), a.getContent(), a.getPublisher(),
                a.getDeptId() != null ? deptNames.get(a.getDeptId()) : null,
                a.getTop(), a.getReads(), a.getPublishAt(), readFlag);
    }
}
