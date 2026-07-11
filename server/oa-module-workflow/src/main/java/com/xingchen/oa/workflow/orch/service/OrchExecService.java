package com.xingchen.oa.workflow.orch.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.ExecDetailResponse;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.ExecNodeResponse;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.ExecResponse;
import com.xingchen.oa.workflow.orch.engine.OrchLiteFlow;
import com.xingchen.oa.workflow.orch.engine.OrchNodeLogger;
import com.xingchen.oa.workflow.orch.engine.OrchRunContext;
import com.xingchen.oa.workflow.orch.engine.OrchToElCompiler;
import com.xingchen.oa.workflow.orch.entity.OrchExec;
import com.xingchen.oa.workflow.orch.entity.OrchExecNode;
import com.xingchen.oa.workflow.orch.entity.OrchFlow;
import com.xingchen.oa.workflow.orch.repository.OrchExecNodeRepository;
import com.xingchen.oa.workflow.orch.repository.OrchExecRepository;
import com.xingchen.oa.workflow.orch.repository.OrchFlowRepository;
import com.yomahub.liteflow.flow.LiteflowResponse;
import jakarta.annotation.PreDestroy;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 编排执行服务：run(异步) / runSubFlow(子编排) / rerun / 分页 / 详情。
 * 流水级 + 节点级留痕；整流超时护栏 10min（超时置 FAILED，执行线程尽力中断）；
 * 整流失败触发 error_flow（错误工作流，失败不级联）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OrchExecService {

    private static final long FLOW_TIMEOUT_MIN = 10;

    private final OrchFlowRepository flowRepository;
    private final OrchExecRepository execRepository;
    private final OrchExecNodeRepository execNodeRepository;
    private final OrchToElCompiler compiler;
    private final OrchLiteFlow liteFlow;
    private final OrchNodeLogger nodeLogger;
    private final ObjectMapper objectMapper;

    private final AtomicInteger seq = new AtomicInteger();
    private final ExecutorService pool = Executors.newFixedThreadPool(4, r -> {
        Thread t = new Thread(r, "orch-exec-" + seq.incrementAndGet());
        t.setDaemon(true);
        return t;
    });

    @PreDestroy
    public void shutdown() {
        pool.shutdownNow();
    }

    /** 手动/定时/事件/Webhook 触发：建流水 + 异步执行，返回 execId。 */
    public Long run(Long flowId, Map<String, Object> payload, String triggerKind) {
        OrchFlow flow = flowRepository.findById(flowId)
                .orElseThrow(() -> new BusinessException(404, "编排不存在"));
        requireRunnable(flow);
        OrchExec exec = createExec(flow, payload, triggerKind);
        submitAsync(exec.getId(), flow, payload, 0);
        return exec.getId();
    }

    /** 子编排（subFlow 节点）：wait=true 同线程同步执行，返回 {execId,status,result}；否则异步 {execId}。 */
    public Map<String, Object> runSubFlow(String flowCode, Map<String, Object> payload, int depth, boolean wait) {
        OrchFlow flow = flowRepository.findByCode(flowCode)
                .orElseThrow(() -> new IllegalStateException("子编排不存在: " + flowCode));
        requireRunnable(flow);
        OrchExec exec = createExec(flow, payload, OrchExec.KIND_SUB_FLOW);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("execId", exec.getId());
        if (wait) {
            OrchExec done = execute(exec.getId(), flow, payload, depth);
            out.put("status", done.getStatus());
            out.put("result", done.getResult());
            if (OrchExec.STATUS_FAILED.equals(done.getStatus())) {
                throw new IllegalStateException("子编排执行失败: " + done.getError());
            }
        } else {
            submitAsync(exec.getId(), flow, payload, depth);
        }
        return out;
    }

    /** 重跑：同 payload 新流水。 */
    public Long rerun(Long execId) {
        OrchExec old = execRepository.findById(execId)
                .orElseThrow(() -> new BusinessException(404, "执行流水不存在"));
        OrchFlow flow = flowRepository.findById(old.getFlowId())
                .orElseThrow(() -> new BusinessException(404, "编排不存在"));
        requireRunnable(flow);
        Map<String, Object> payload = parsePayload(old.getPayload());
        OrchExec exec = createExec(flow, payload, OrchExec.KIND_RERUN);
        submitAsync(exec.getId(), flow, payload, 0);
        return exec.getId();
    }

    public PageResult<ExecResponse> page(Long flowId, String status, int pageNum, int pageSize) {
        Specification<OrchExec> cond = (root, query, cb) -> {
            List<Predicate> ps = new ArrayList<>();
            if (flowId != null) {
                ps.add(cb.equal(root.get("flowId"), flowId));
            }
            if (StringUtils.hasText(status)) {
                ps.add(cb.equal(root.get("status"), status));
            }
            return cb.and(ps.toArray(new Predicate[0]));
        };
        Page<OrchExec> page = execRepository.findAll(cond,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        return new PageResult<>(page.getContent().stream().map(this::toResponse).toList(),
                page.getTotalElements(), page.getNumber() + 1, page.getSize());
    }

    public ExecDetailResponse detail(Long execId) {
        OrchExec exec = execRepository.findById(execId)
                .orElseThrow(() -> new BusinessException(404, "执行流水不存在"));
        List<ExecNodeResponse> nodes = execNodeRepository.findByExecIdOrderByIdAsc(execId).stream()
                .map(n -> new ExecNodeResponse(n.getId(), n.getNodeId(), n.getNodeName(), n.getStatus(),
                        n.getAttempts(), n.getInput(), n.getOutput(), n.getError(), n.getCostMs(), n.getStartedAt()))
                .toList();
        return new ExecDetailResponse(toResponse(exec), nodes);
    }

    // ==================== 内部 ====================

    private void requireRunnable(OrchFlow flow) {
        if (flow.getVersion() == null || flow.getVersion() <= 0 || !StringUtils.hasText(flow.getElExpr())) {
            throw new BusinessException(400, "编排未发布，请先发布（编译校验）: " + flow.getCode());
        }
        if (!Boolean.TRUE.equals(flow.getEnabled())) {
            throw new BusinessException(400, "编排已停用: " + flow.getCode());
        }
    }

    private OrchExec createExec(OrchFlow flow, Map<String, Object> payload, String kind) {
        OrchExec exec = new OrchExec();
        exec.setFlowId(flow.getId());
        exec.setFlowCode(flow.getCode());
        exec.setTriggerKind(kind);
        try {
            exec.setPayload(payload == null ? null : objectMapper.writeValueAsString(payload));
        } catch (Exception e) {
            exec.setPayload(String.valueOf(payload));
        }
        exec.setStatus(OrchExec.STATUS_RUNNING);
        return execRepository.save(exec);
    }

    private void submitAsync(Long execId, OrchFlow flow, Map<String, Object> payload, int depth) {
        CompletableFuture.runAsync(() -> execute(execId, flow, payload, depth), pool)
                .orTimeout(FLOW_TIMEOUT_MIN, TimeUnit.MINUTES)
                .exceptionally(e -> {
                    // 超时护栏：仍 RUNNING 则置 FAILED（执行线程为守护线程，尽力而为）
                    try {
                        execRepository.findById(execId).ifPresent(exec -> {
                            if (OrchExec.STATUS_RUNNING.equals(exec.getStatus())) {
                                exec.setStatus(OrchExec.STATUS_FAILED);
                                exec.setError("执行超时（>" + FLOW_TIMEOUT_MIN + "min）或异常: " + e.getMessage());
                                exec.setEndedAt(OffsetDateTime.now());
                                execRepository.save(exec);
                            }
                        });
                    } catch (Exception ignored) {
                        // 护栏失败不再级联
                    }
                    return null;
                });
    }

    /** 同步执行一条流水（异步任务/子编排共用）。 */
    private OrchExec execute(Long execId, OrchFlow flow, Map<String, Object> payload, int depth) {
        OrchExec exec = execRepository.findById(execId).orElseThrow();
        try {
            JsonNode model = objectMapper.readTree(flow.getDesignerJson());
            List<JsonNode> nodes = new ArrayList<>();
            model.path("nodes").forEach(nodes::add);
            String chainId = liteFlow.ensureChain(flow.getId(), flow.getVersion(), flow.getElExpr());
            OrchRunContext ctx = new OrchRunContext(execId, flow.getId(), depth, payload,
                    nodes, compiler.edgesBySource(model));

            LiteflowResponse resp = liteFlow.run(chainId, ctx);
            if (resp.isSuccess()) {
                exec.setStatus(OrchExec.STATUS_SUCCESS);
                exec.setResult(nodeLogger.truncate(ctx.result));
            } else {
                exec.setStatus(OrchExec.STATUS_FAILED);
                Exception cause = resp.getCause();
                exec.setError(cause != null ? String.valueOf(cause.getMessage()) : "执行失败");
            }
        } catch (Exception e) {
            exec.setStatus(OrchExec.STATUS_FAILED);
            exec.setError(String.valueOf(e.getMessage()));
        }
        exec.setEndedAt(OffsetDateTime.now());
        execRepository.save(exec);
        if (OrchExec.STATUS_FAILED.equals(exec.getStatus())) {
            triggerErrorFlow(flow, exec, payload);
        }
        return exec;
    }

    /** 错误工作流（P0）：整流失败以 {error, failedNodeId, payload} 触发；错误流失败不级联。 */
    private void triggerErrorFlow(OrchFlow flow, OrchExec failedExec, Map<String, Object> payload) {
        Long errorFlowId = flow.getErrorFlowId();
        if (errorFlowId == null || errorFlowId.equals(flow.getId())) {
            return;
        }
        try {
            OrchFlow errorFlow = flowRepository.findById(errorFlowId).orElse(null);
            if (errorFlow == null || !Boolean.TRUE.equals(errorFlow.getEnabled())
                    || errorFlow.getVersion() == null || errorFlow.getVersion() <= 0) {
                return;
            }
            String failedNodeId = execNodeRepository.findByExecIdOrderByIdAsc(failedExec.getId()).stream()
                    .filter(n -> OrchExecNode.STATUS_FAILED.equals(n.getStatus()))
                    .map(OrchExecNode::getNodeId)
                    .reduce((a, b) -> b).orElse(null);
            Map<String, Object> errPayload = new LinkedHashMap<>();
            errPayload.put("error", failedExec.getError());
            errPayload.put("failedNodeId", failedNodeId);
            errPayload.put("failedExecId", failedExec.getId());
            errPayload.put("flowCode", flow.getCode());
            errPayload.put("payload", payload);
            OrchExec errExec = createExec(errorFlow, errPayload, OrchExec.KIND_ERROR_FLOW);
            submitAsync(errExec.getId(), errorFlow, errPayload, 0);
        } catch (Exception e) {
            log.warn("错误工作流触发失败（不级联） flow={}: {}", flow.getCode(), e.getMessage());
        }
    }

    private Map<String, Object> parsePayload(String json) {
        if (!StringUtils.hasText(json)) {
            return new LinkedHashMap<>();
        }
        try {
            return objectMapper.readValue(json, new tools.jackson.core.type.TypeReference<>() {
            });
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    private ExecResponse toResponse(OrchExec e) {
        return new ExecResponse(e.getId(), e.getFlowId(), e.getFlowCode(), e.getTriggerKind(),
                e.getStatus(), e.getPayload(), e.getResult(), e.getError(), e.getStartedAt(), e.getEndedAt());
    }
}
