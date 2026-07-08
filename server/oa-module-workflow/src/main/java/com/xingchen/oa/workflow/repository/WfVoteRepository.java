package com.xingchen.oa.workflow.repository;

import com.xingchen.oa.workflow.entity.WfVote;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WfVoteRepository extends JpaRepository<WfVote, Long> {

    List<WfVote> findByProcInstIdAndNodeId(String procInstId, String nodeId);

    boolean existsByProcInstIdAndNodeIdAndUserId(String procInstId, String nodeId, Long userId);
}
