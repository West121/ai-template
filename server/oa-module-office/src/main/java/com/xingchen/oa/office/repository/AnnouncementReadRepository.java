package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.AnnouncementRead;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AnnouncementReadRepository extends JpaRepository<AnnouncementRead, Long> {

    boolean existsByAnnouncementIdAndUserId(Long announcementId, Long userId);

    long countByUserId(Long userId);

    List<AnnouncementRead> findByUserId(Long userId);
}
