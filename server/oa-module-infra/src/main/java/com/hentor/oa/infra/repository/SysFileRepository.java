package com.hentor.oa.infra.repository;

import com.hentor.oa.infra.entity.SysFile;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SysFileRepository extends JpaRepository<SysFile, Long> {

    Page<SysFile> findByOriginalNameContaining(String keyword, Pageable pageable);

    Page<SysFile> findByUploaderId(Long uploaderId, Pageable pageable);

    Page<SysFile> findByOriginalNameContainingAndUploaderId(String keyword, Long uploaderId, Pageable pageable);

    Optional<SysFile> findFirstByFileHashOrderByIdAsc(String fileHash);
}
