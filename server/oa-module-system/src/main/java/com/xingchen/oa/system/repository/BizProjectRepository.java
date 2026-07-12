package com.xingchen.oa.system.repository;

import com.xingchen.oa.system.entity.BizProject;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface BizProjectRepository extends JpaRepository<BizProject, Long> {

    List<BizProject> findByEnabledTrueOrderByIdAsc();
}
