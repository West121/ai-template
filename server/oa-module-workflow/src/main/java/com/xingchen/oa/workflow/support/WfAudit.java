package com.xingchen.oa.workflow.support;

import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.workflow.entity.WfOperation;
import com.xingchen.oa.workflow.notify.NotifyDispatcher;
import com.xingchen.oa.workflow.notify.NotifyMessage;
import com.xingchen.oa.workflow.repository.WfOperationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;

/**
 * 工作流动作审计 + 站内通知统一写入口（P2 各操作复用，避免每个 service 重复样板）。
 */
@com.xingchen.oa.common.script.ScriptApi("工作流审计/站内通知：notify(用户id,类型,标题,内容,流程实例id) 发站内通知；op 记操作留痕")
@Component
@RequiredArgsConstructor
public class WfAudit {

    private final WfOperationRepository operationRepository;
    private final NotifyDispatcher notifyDispatcher;
    private final ObjectMapper objectMapper;

    public void op(String pid, String taskId, String nodeId, String nodeName,
                   UserContext ctx, String action, String comment) {
        op(pid, taskId, nodeId, nodeName, ctx, action, comment, null);
    }

    public void op(String pid, String taskId, String nodeId, String nodeName,
                   UserContext ctx, String action, String comment, Map<String, Object> detail) {
        WfOperation o = new WfOperation();
        o.setProcInstId(pid);
        o.setTaskId(taskId);
        o.setNodeId(nodeId);
        o.setNodeName(nodeName);
        if (ctx != null) {
            o.setActorId(ctx.getUserId());
            o.setActorName(WfSupport.displayName(ctx));
        }
        o.setAction(action);
        o.setComment(comment);
        if (detail != null && !detail.isEmpty()) {
            try {
                o.setDetailJson(objectMapper.writeValueAsString(detail));
            } catch (Exception ignored) {
                // 明细序列化失败不阻断
            }
        }
        operationRepository.save(o);
    }

    public void notify(Long uid, String type, String title, String content, String pid) {
        if (uid == null) {
            return;
        }
        notifyDispatcher.dispatch(new NotifyMessage(uid, type, title, content, pid));
    }
}
