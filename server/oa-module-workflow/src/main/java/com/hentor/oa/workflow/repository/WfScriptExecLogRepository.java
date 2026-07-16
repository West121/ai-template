package com.hentor.oa.workflow.repository;

import com.hentor.oa.workflow.entity.WfScriptExecLog;
import org.springframework.data.jpa.repository.JpaRepository;

/** Tier 2 脚本执行审计仓库（V18，{@code wf_script_exec_log}）。 */
public interface WfScriptExecLogRepository extends JpaRepository<WfScriptExecLog, Long> {
}
