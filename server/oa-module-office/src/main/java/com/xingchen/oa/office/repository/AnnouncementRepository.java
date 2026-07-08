package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.Announcement;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AnnouncementRepository extends JpaRepository<Announcement, Long> {

    Page<Announcement> findByCategory(String category, Pageable pageable);
}
