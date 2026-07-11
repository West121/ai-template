package com.xingchen.oa.workflow.orch.engine.nodes;

import com.xingchen.oa.workflow.engine.AssigneeResolver;
import com.xingchen.oa.workflow.entity.WfNotify;
import com.xingchen.oa.workflow.orch.engine.OrchRunContext;
import com.xingchen.oa.workflow.orch.engine.OrchSpringHolder;
import com.xingchen.oa.workflow.orch.engine.OrchTemplate;
import com.xingchen.oa.workflow.repository.WfNotifyRepository;
import tools.jackson.databind.JsonNode;

import java.util.List;
import java.util.Map;

/**
 * 站内通知节点：config {recipients: OrgRef[]（{kind:USER|ROLE|DEPT,id}）, title, content}（标题/内容模板插值）。
 * 收件人经 AssigneeResolver.resolveRefs 展开，写 wf_notify（RESULT 型）。输出 {recipients: n}。
 */
public class OrchNotifyNode extends OrchBaseNode {

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) {
        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        Map<String, Object> evalCtx = ctx.evalCtx();
        String title = tpl.renderString(config.path("title").asString("编排通知"), evalCtx);
        String content = tpl.renderString(config.path("content").asString(""), evalCtx);

        List<Long> userIds = OrchSpringHolder.bean(AssigneeResolver.class)
                .resolveRefs(config.path("recipients"));
        WfNotifyRepository repo = OrchSpringHolder.bean(WfNotifyRepository.class);
        for (Long uid : userIds) {
            WfNotify n = new WfNotify();
            n.setUserId(uid);
            n.setType(WfNotify.TYPE_RESULT);
            n.setTitle(title);
            n.setContent(content);
            n.setReadFlag(false);
            repo.save(n);
        }
        return Map.of("recipients", userIds.size());
    }
}
