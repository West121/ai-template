package com.xingchen.oa.infra.repository;

import com.xingchen.oa.infra.entity.SysFile;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SysFileRepository extends JpaRepository<SysFile, Long> {

    Page<SysFile> findByOriginalNameContaining(String keyword, Pageable pageable);

    Optional<SysFile> findFirstByFileHashOrderByIdAsc(String fileHash);
}
