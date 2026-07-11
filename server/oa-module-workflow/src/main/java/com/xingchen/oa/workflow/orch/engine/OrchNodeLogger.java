package com.xingchen.oa.workflow.orch.engine;

import com.xingchen.oa.workflow.orch.entity.OrchExecNode;
import com.xingchen.oa.workflow.orch.repository.OrchExecNodeRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * 节点级留痕：input/output 序列化截 8KB，独立事务逐条落库（异步执行线程内）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OrchNodeLogger {

    public static final int MAX_LEN = 8 * 1024;

    private final OrchExecNodeRepository repository;
    private final ObjectMapper objectMapper;

    public OrchExecNode start(long execId, String nodeId, String nodeName, Object input) {
        OrchExecNode row = new OrchExecNode();
        row.setExecId(execId);
        row.setNodeId(nodeId);
        row.setNodeName(nodeName);
        row.setStatus(OrchExecNode.STATUS_RUNNING);
        row.setInput(truncate(input));
        try {
            return repository.save(row);
        } catch (Exception e) {
            log.warn("编排节点留痕(开始)失败 exec={} node={}: {}", execId, nodeId, e.getMessage());
            return row;
        }
    }

    public void finish(OrchExecNode row, boolean success, Object output, String error, int attempts, long costMs) {
        row.setStatus(success ? OrchExecNode.STATUS_SUCCESS : OrchExecNode.STATUS_FAILED);
        row.setOutput(truncate(output));
        row.setError(error != null && error.length() > MAX_LEN ? error.substring(0, MAX_LEN) : error);
        row.setAttempts(attempts);
        row.setCostMs(costMs);
        try {
            repository.save(row);
        } catch (Exception e) {
            log.warn("编排节点留痕(结束)失败 exec={} node={}: {}", row.getExecId(), row.getNodeId(), e.getMessage());
        }
    }

    /** 序列化 + 截 8KB（对象优先 JSON，失败退 toString）。 */
    public String truncate(Object value) {
        if (value == null) {
            return null;
        }
        String s;
        if (value instanceof String str) {
            s = str;
        } else {
            try {
                s = objectMapper.writeValueAsString(value);
            } catch (Exception e) {
                s = String.valueOf(value);
            }
        }
        return s.length() > MAX_LEN ? s.substring(0, MAX_LEN) : s;
    }
}
