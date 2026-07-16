package com.hentor.oa.workflow.orch.engine.nodes;

import com.hentor.oa.workflow.orch.engine.OrchNodeLogger;
import com.hentor.oa.workflow.orch.engine.OrchRunContext;
import com.hentor.oa.workflow.orch.engine.OrchSpringHolder;
import com.yomahub.liteflow.core.NodeComponent;
import tools.jackson.databind.JsonNode;

import java.util.Map;

/**
 * wait 节点（§9.2 分段链的段终结标记）：本身不阻塞线程——仅置 {@code ctx.waitNodeId}，
 * 段链随后正常结束，由 OrchExecService 把 exec 挂起为 WAITING（生成 resume_token + 快照 + 超时定时器）。
 * 留痕行保持 RUNNING，resume/超时时由服务端收口为 SUCCESS/FAILED。
 */
public class OrchWaitNode extends NodeComponent {

    @Override
    public void process() throws Exception {
        OrchRunContext ctx = this.getContextBean(OrchRunContext.class);
        String nodeId = this.getTag();
        JsonNode node = ctx.node(nodeId);
        OrchSpringHolder.bean(OrchNodeLogger.class).start(ctx.execId, nodeId,
                node != null ? node.path("name").asString(nodeId) : nodeId,
                Map.of("waiting", true));
        ctx.waitNodeId = nodeId;
    }
}
