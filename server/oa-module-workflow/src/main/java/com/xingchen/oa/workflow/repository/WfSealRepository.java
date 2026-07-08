package com.xingchen.oa.workflow.repository;

import com.xingchen.oa.workflow.entity.WfSeal;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WfSealRepository extends JpaRepository<WfSeal, Long> {

    List<WfSeal> findAllByOrderByIdDesc();
}
