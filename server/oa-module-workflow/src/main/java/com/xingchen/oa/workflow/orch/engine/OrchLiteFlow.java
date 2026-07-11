package com.xingchen.oa.workflow.orch.engine;

import com.xingchen.oa.workflow.orch.engine.nodes.OrchConditionNode;
import com.xingchen.oa.workflow.orch.engine.nodes.OrchDataMapNode;
import com.xingchen.oa.workflow.orch.engine.nodes.OrchDelayNode;
import com.xingchen.oa.workflow.orch.engine.nodes.OrchEndNode;
import com.xingchen.oa.workflow.orch.engine.nodes.OrchErrorRouterNode;
import com.xingchen.oa.workflow.orch.engine.nodes.OrchHttpNode;
import com.xingchen.oa.workflow.orch.engine.nodes.OrchLlmNode;
import com.xingchen.oa.workflow.orch.engine.nodes.OrchLoopNode;
import com.xingchen.oa.workflow.orch.engine.nodes.OrchNotifyNode;
import com.xingchen.oa.workflow.orch.engine.nodes.OrchScriptNode;
import com.xingchen.oa.workflow.orch.engine.nodes.OrchStartApprovalNode;
import com.xingchen.oa.workflow.orch.engine.nodes.OrchSubFlowNode;
import com.yomahub.liteflow.builder.LiteFlowNodeBuilder;
import com.yomahub.liteflow.builder.el.LiteFlowChainELBuilder;
import com.yomahub.liteflow.core.FlowExecutor;
import com.yomahub.liteflow.core.FlowExecutorHolder;
import com.yomahub.liteflow.flow.LiteflowResponse;
import com.yomahub.liteflow.property.LiteflowConfig;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 编排 LiteFlow 底座（<b>编程式 FlowExecutor</b>，选型说明）：
 * 平台的 liteflow-spring-boot4-starter 保持 {@code liteflow.enable=false}（仅作 Tier2 脚本 SPI），
 * 编排走 {@link FlowExecutorHolder#loadInstance} 编程式实例——与脚本引擎用法完全隔离、
 * 不受 starter 自动装配/规则源约束；组件经 {@link LiteFlowNodeBuilder} 显式注册（反射实例化，
 * 组件内经 {@link OrchSpringHolder} 取平台服务）；链经 {@link LiteFlowChainELBuilder} 动态注册
 * （chainId 覆盖式，发布新版本即替换）。
 */
@Slf4j
@Component
public class OrchLiteFlow {

    private volatile FlowExecutor executor;
    /** chainId → 已注册的 EL（内容变更才重建链）。 */
    private final Map<String, String> registered = new ConcurrentHashMap<>();

    /** 惰性初始化：首次执行才拉起引擎 + 注册组件（不影响应用启动）。 */
    private FlowExecutor executor() {
        if (executor == null) {
            synchronized (this) {
                if (executor == null) {
                    LiteflowConfig config = new LiteflowConfig();
                    config.setPrintBanner(false);
                    FlowExecutor ex = FlowExecutorHolder.loadInstance(config);
                    registerNodes();
                    executor = ex;
                    log.info("编排引擎初始化：LiteFlow 编程式 FlowExecutor + {} 类组件注册完成", 10);
                }
            }
        }
        return executor;
    }

    private void registerNodes() {
        common("orchHttp", "HTTP", OrchHttpNode.class);
        common("orchScript", "脚本", OrchScriptNode.class);
        common("orchDataMap", "数据映射", OrchDataMapNode.class);
        common("orchLlm", "AI", OrchLlmNode.class);
        common("orchNotify", "通知", OrchNotifyNode.class);
        common("orchDelay", "延时", OrchDelayNode.class);
        common("orchStartApproval", "发起审批", OrchStartApprovalNode.class);
        common("orchSubFlow", "子编排", OrchSubFlowNode.class);
        common("orchEnd", "结束", OrchEndNode.class);
        LiteFlowNodeBuilder.createSwitchNode()
                .setId("orchCondition").setName("条件").setClazz(OrchConditionNode.class).build();
        LiteFlowNodeBuilder.createSwitchNode()
                .setId("orchErrorRouter").setName("失败路由").setClazz(OrchErrorRouterNode.class).build();
        LiteFlowNodeBuilder.createIteratorNode()
                .setId("orchLoop").setName("循环").setClazz(OrchLoopNode.class).build();
    }

    private void common(String id, String name, Class<?> clazz) {
        LiteFlowNodeBuilder.createCommonNode().setId(id).setName(name).setClazz(clazz).build();
    }

    /** 注册/更新链（EL 未变则跳过），返回 chainId。 */
    public String ensureChain(long flowId, int version, String el) {
        String chainId = "orch_" + flowId + "_v" + version;
        String prev = registered.get(chainId);
        if (!el.equals(prev)) {
            executor(); // 确保组件已注册
            LiteFlowChainELBuilder.createChain().setChainId(chainId).setEL(el).build();
            registered.put(chainId, el);
        }
        return chainId;
    }

    public LiteflowResponse run(String chainId, OrchRunContext ctx) {
        return executor().execute2Resp(chainId, null, new Object[]{ctx});
    }
}
