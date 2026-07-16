package com.hentor.oa.workflow.orch.engine.nodes;

import com.hentor.oa.workflow.orch.engine.OrchRunContext;
import com.yomahub.liteflow.core.NodeSwitchComponent;
import tools.jackson.databind.JsonNode;

/**
 * onError=BRANCH 路由器：tag=动作节点 id。动作失败（ctx.failedNodes 含该 id）→ 失败支（errorBranch:true 边
 * 的 target），否则 → 成功支。由 {@code OrchToElCompiler.compileErrorBranch} 编译挂在动作节点之后。
 */
public class OrchErrorRouterNode extends NodeSwitchComponent {

    @Override
    public String processSwitch() throws Exception {
        OrchRunContext ctx = this.getContextBean(OrchRunContext.class);
        String actionNodeId = this.getTag();
        boolean failed = ctx.failedNodes.contains(actionNodeId);
        String okTarget = null;
        String errTarget = null;
        for (JsonNode edge : ctx.outgoing(actionNodeId)) {
            if (edge.path("errorBranch").asBoolean(false)) {
                errTarget = edge.path("target").asString(null);
            } else {
                okTarget = edge.path("target").asString(null);
            }
        }
        String chosen = failed ? errTarget : okTarget;
        if (chosen == null) {
            throw new IllegalStateException("errorRouter 找不到" + (failed ? "失败" : "成功") + "支: " + actionNodeId);
        }
        return chosen;
    }
}
