package com.hentor.oa.system.repository;

import com.hentor.oa.system.entity.BizProject;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface BizProjectRepository extends JpaRepository<BizProject, Long> {

    List<BizProject> findByEnabledTrueOrderByIdAsc();
}
