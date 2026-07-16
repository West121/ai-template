package com.hentor.oa.workflow.orch.service;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.workflow.orch.dto.OrchDtos.ExecDetailResponse;
import com.hentor.oa.workflow.orch.dto.OrchDtos.ExecNodeResponse;
import com.hentor.oa.workflow.orch.dto.OrchDtos.ExecResponse;
import com.hentor.oa.workflow.orch.engine.OrchLiteFlow;
import com.hentor.oa.workflow.orch.engine.OrchNodeLogger;
import com.hentor.oa.workflow.orch.engine.OrchRunContext;
import com.hentor.oa.workflow.orch.engine.OrchToElCompiler;
import com.hentor.oa.workflow.orch.engine.OrchWaitManager;
import com.hentor.oa.workflow.orch.entity.OrchExec;
import com.hentor.oa.workflow.orch.entity.OrchExecNode;
import com.hentor.oa.workflow.orch.entity.OrchFlow;
import com.hentor.oa.workflow.orch.repository.OrchExecNodeRepository;
import com.hentor.oa.workflow.orch.repository.OrchExecRepository;
import com.hentor.oa.workflow.orch.repository.OrchFlowRepository;
import com.yomahub.liteflow.flow.LiteflowResponse;
import jakarta.annotation.PreDestroy;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
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
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 编排执行服务：run(异步) / runSubFlow / rerun / wait 挂起恢复(§9.2) / 失败续跑(§9.3) /
 * webhook 同步响应(§9.4) / 分页 / 详情。
 *
 * <p><b>分段链</b>：主段 EL 在发布时编译（wait 节点为段终结标记）；段执行完若 ctx.waitNodeId 非空 →
 * exec 挂起 WAITING（resume_token + context_snapshot 完整快照 + 超时定时器），恢复时按 wait 节点
 * 现场编译后继段（chainKey=orch_{flowId}_v{ver}_w_{waitNodeId}）继续同一 exec。
 * 失败续跑则为新 exec（parent_exec_id 血缘）：复用父快照 vars/outputs，从失败节点(含)段起跑。
 *
 * <p>流水级 + 节点级留痕；整流超时护栏 10min；整流失败触发 error_flow（不级联）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OrchExecService {

    private static final long FLOW_TIMEOUT_MIN = 10;
    private static final long WAIT_DEFAULT_MS = 24 * 3600_000L;
    private static final long WAIT_MAX_MS = 7 * 24 * 3600_000L;

    private final OrchFlowRepository flowRepository;
    private final OrchExecRepository execRepository;
    private final OrchExecNodeRepository execNodeRepository;
    private final OrchToElCompiler compiler;
    private final OrchLiteFlow liteFlow;
    private final OrchNodeLogger nodeLogger;
    private final ObjectMapper objectMapper;
    /** 懒注入：WaitManager 反向依赖本服务（超时回调），避免装配环。 */
    private final ObjectProvider<OrchWaitManager> waitManager;

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

    // ==================== 触发入口 ====================

    /** 手动触发：建流水 + 异步执行，返回 execId。 */
    public Long run(Long flowId, Map<String, Object> payload, String triggerKind) {
        OrchFlow flow = flowRepository.findById(flowId)
                .orElseThrow(() -> new BusinessException(404, "编排不存在"));
        return trigger(flow, payload, triggerKind, 0);
    }

    /** 定时/事件等触发器统一入口：depth=编排链深度（事件桥防死循环护栏）。 */
    public Long trigger(OrchFlow flow, Map<String, Object> payload, String triggerKind, int depth) {
        requireRunnable(flow);
        OrchExec exec = createExec(flow, payload, triggerKind, null);
        OrchRunContext ctx = newCtx(exec.getId(), flow, payload, depth);
        submitAsync(exec.getId(), flow, ctx, flow.getElExpr(), mainChainKey(flow));
        return exec.getId();
    }

    /** webhook 触发（§9.4）：流含 respond 节点时挂同步响应 future，由 hooks 端点等待。 */
    public WebhookRun runWebhook(OrchFlow flow, Map<String, Object> payload) {
        requireRunnable(flow);
        OrchExec exec = createExec(flow, payload, OrchExec.KIND_WEBHOOK, null);
        OrchRunContext ctx = newCtx(exec.getId(), flow, payload, 0);
        long syncTimeoutMs = 10_000;
        CompletableFuture<Map<String, Object>> future = null;
        try {
            JsonNode model = objectMapper.readTree(flow.getDesignerJson());
            boolean hasRespond = false;
            for (JsonNode n : model.path("nodes")) {
                if ("respond".equals(n.path("type").asString(""))) {
                    hasRespond = true;
                }
                if ("trigger".equals(n.path("type").asString(""))) {
                    syncTimeoutMs = Math.max(1000,
                            Math.min(n.path("config").path("syncTimeoutMs").asLong(10_000), 30_000));
                }
            }
            if (hasRespond) {
                future = new CompletableFuture<>();
                ctx.respondFuture = future;
            }
        } catch (Exception ignored) {
            // 模型解析失败按无 respond 处理
        }
        submitAsync(exec.getId(), flow, ctx, flow.getElExpr(), mainChainKey(flow));
        return new WebhookRun(exec.getId(), future, syncTimeoutMs);
    }

    /** 子编排（subFlow 节点）：wait=true 同线程同步执行，返回 {execId,status,result}；否则异步 {execId}。 */
    public Map<String, Object> runSubFlow(String flowCode, Map<String, Object> payload, int depth, boolean wait) {
        OrchFlow flow = flowRepository.findByCode(flowCode)
                .orElseThrow(() -> new IllegalStateException("子编排不存在: " + flowCode));
        requireRunnable(flow);
        OrchExec exec = createExec(flow, payload, OrchExec.KIND_SUB_FLOW, null);
        OrchRunContext ctx = newCtx(exec.getId(), flow, payload, depth);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("execId", exec.getId());
        if (wait) {
            OrchExec done = execute(exec.getId(), flow, ctx, flow.getElExpr(), mainChainKey(flow));
            out.put("status", done.getStatus());
            out.put("result", done.getResult());
            if (OrchExec.STATUS_FAILED.equals(done.getStatus())) {
                throw new IllegalStateException("子编排执行失败: " + done.getError());
            }
        } else {
            submitAsync(exec.getId(), flow, ctx, flow.getElExpr(), mainChainKey(flow));
        }
        return out;
    }

    /** 重跑：同 payload 全新流水（从头）。 */
    public Long rerun(Long execId) {
        OrchExec old = execRepository.findById(execId)
                .orElseThrow(() -> new BusinessException(404, "执行流水不存在"));
        OrchFlow flow = flowRepository.findById(old.getFlowId())
                .orElseThrow(() -> new BusinessException(404, "编排不存在"));
        requireRunnable(flow);
        Map<String, Object> payload = parsePayload(old.getPayload());
        OrchExec exec = createExec(flow, payload, OrchExec.KIND_RERUN, null);
        OrchRunContext ctx = newCtx(exec.getId(), flow, payload, 0);
        submitAsync(exec.getId(), flow, ctx, flow.getElExpr(), mainChainKey(flow));
        return exec.getId();
    }

    // ==================== §9.2 wait 挂起 / 恢复 ====================

    /** 免登录恢复：POST /api/orch/resume/{token}，body 存 wait 节点 saveAs，续执行后继段。 */
    public Long resumeByToken(String token, Map<String, Object> body) {
        OrchExec exec = execRepository.findByResumeToken(token)
                .filter(e -> OrchExec.STATUS_WAITING.equals(e.getStatus()))
                .orElseThrow(() -> new BusinessException(404, "无效的 resume token"));
        OrchFlow flow = flowRepository.findById(exec.getFlowId())
                .orElseThrow(() -> new BusinessException(404, "编排不存在"));
        resumeInternal(exec, flow, body, false);
        return exec.getId();
    }

    /** wait 超时回调（OrchWaitManager 定时器/启动扫描）：onError=CONTINUE 续跑（saveAs=null），否则 FAILED。 */
    public void waitTimeout(Long execId) {
        OrchExec exec = execRepository.findById(execId).orElse(null);
        if (exec == null || !OrchExec.STATUS_WAITING.equals(exec.getStatus())) {
            return;
        }
        OrchFlow flow = flowRepository.findById(exec.getFlowId()).orElse(null);
        if (flow == null) {
            return;
        }
        JsonNode snapshot = parseSnapshot(exec.getContextSnapshot());
        String waitNodeId = snapshot.path("waitNodeId").asString(null);
        String onError = "ABORT";
        try {
            JsonNode model = objectMapper.readTree(flow.getDesignerJson());
            for (JsonNode n : model.path("nodes")) {
                if (n.path("id").asString("").equals(waitNodeId)) {
                    onError = n.path("config").path("onError").asString("ABORT").toUpperCase();
                }
            }
        } catch (Exception ignored) {
            // 保持 ABORT
        }
        markWaitNodeRow(exec.getId(), waitNodeId, false, null, "wait timeout");
        if ("CONTINUE".equals(onError)) {
            log.info("编排 wait 超时(onError=CONTINUE)续跑 exec={} node={}", execId, waitNodeId);
            resumeInternal(exec, flow, null, true);
            return;
        }
        exec.setStatus(OrchExec.STATUS_FAILED);
        exec.setError("wait timeout: " + waitNodeId);
        exec.setResumeToken(null);
        exec.setEndedAt(OffsetDateTime.now());
        execRepository.save(exec);
        triggerErrorFlow(flow, exec, parsePayload(exec.getPayload()));
    }

    /** 恢复公共路径：快照回填 → saveAs 存 body → 段起跑（timeout=true 时 body 为 null 且节点已记 FAILED）。 */
    private void resumeInternal(OrchExec exec, OrchFlow flow, Map<String, Object> body, boolean fromTimeout) {
        JsonNode snapshot = parseSnapshot(exec.getContextSnapshot());
        String waitNodeId = snapshot.path("waitNodeId").asString(null);
        if (!StringUtils.hasText(waitNodeId)) {
            throw new BusinessException(400, "挂起快照缺少 waitNodeId，无法恢复");
        }
        JsonNode model = parseModel(flow.getDesignerJson());
        String el = compiler.compileAfterWait(model, waitNodeId);

        OrchRunContext ctx = newCtx(exec.getId(), flow, toMap(snapshot.path("payload")), 0);
        ctx.preload(toMap(snapshot.path("vars")), toMap(snapshot.path("outputs")), toStrings(snapshot.path("failedNodes")));
        String saveAs = null;
        for (JsonNode n : model.path("nodes")) {
            if (n.path("id").asString("").equals(waitNodeId)) {
                saveAs = n.path("config").path("saveAs").asString(null);
            }
        }
        if (StringUtils.hasText(saveAs)) {
            ctx.vars.put(saveAs, body);
        }
        if (!fromTimeout) {
            markWaitNodeRow(exec.getId(), waitNodeId, true, body, null);
        }
        waitManager.getObject().cancel(exec.getId());
        exec.setStatus(OrchExec.STATUS_RUNNING);
        exec.setResumeToken(null);
        exec.setCurrentSegment((exec.getCurrentSegment() == null ? 0 : exec.getCurrentSegment()) + 1);
        execRepository.save(exec);
        submitAsync(exec.getId(), flow, ctx, el, mainChainKey(flow) + "_w_" + waitNodeId);
    }

    // ==================== §9.3 失败续跑 ====================

    /** 从失败节点(含)续跑：新 exec（parent_exec_id 血缘），复用父快照 vars/outputs。 */
    public Long resumeFromFailure(Long execId) {
        OrchExec parent = execRepository.findById(execId)
                .orElseThrow(() -> new BusinessException(404, "执行流水不存在"));
        if (!OrchExec.STATUS_FAILED.equals(parent.getStatus())) {
            throw new BusinessException(400, "仅 FAILED 流水可从失败节点续跑");
        }
        OrchFlow flow = flowRepository.findById(parent.getFlowId())
                .orElseThrow(() -> new BusinessException(404, "编排不存在"));
        requireRunnable(flow);
        String failedNodeId = execNodeRepository.findByExecIdOrderByIdAsc(execId).stream()
                .filter(n -> OrchExecNode.STATUS_FAILED.equals(n.getStatus()))
                .map(OrchExecNode::getNodeId)
                .reduce((a, b) -> b)
                .orElseThrow(() -> new BusinessException(400, "无法定位失败节点（无 FAILED 节点留痕）"));
        JsonNode model = parseModel(flow.getDesignerJson());
        String el = compiler.compileFromNode(model, failedNodeId); // 失败点在 parallel/loop 体内时抛 400

        Map<String, Object> payload = parsePayload(parent.getPayload());
        OrchExec exec = createExec(flow, payload, OrchExec.KIND_RESUME_FAIL, parent.getId());
        OrchRunContext ctx = newCtx(exec.getId(), flow, payload, 0);
        JsonNode snapshot = parseSnapshot(parent.getContextSnapshot());
        ctx.preload(toMap(snapshot.path("vars")), toMap(snapshot.path("outputs")), null);
        submitAsync(exec.getId(), flow, ctx, el, mainChainKey(flow) + "_f_" + failedNodeId);
        return exec.getId();
    }

    // ==================== 查询 ====================

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

    private String mainChainKey(OrchFlow flow) {
        return "orch_" + flow.getId() + "_v" + flow.getVersion();
    }

    private OrchExec createExec(OrchFlow flow, Map<String, Object> payload, String kind, Long parentExecId) {
        OrchExec exec = new OrchExec();
        exec.setFlowId(flow.getId());
        exec.setFlowCode(flow.getCode());
        exec.setTriggerKind(kind);
        exec.setParentExecId(parentExecId);
        try {
            exec.setPayload(payload == null ? null : objectMapper.writeValueAsString(payload));
        } catch (Exception e) {
            exec.setPayload(String.valueOf(payload));
        }
        exec.setStatus(OrchExec.STATUS_RUNNING);
        return execRepository.save(exec);
    }

    private OrchRunContext newCtx(Long execId, OrchFlow flow, Map<String, Object> payload, int depth) {
        try {
            JsonNode model = objectMapper.readTree(flow.getDesignerJson());
            List<JsonNode> nodes = new ArrayList<>();
            model.path("nodes").forEach(nodes::add);
            return new OrchRunContext(execId, flow.getId(), depth, payload, nodes, compiler.edgesBySource(model));
        } catch (Exception e) {
            throw new BusinessException(400, "编排模型解析失败: " + e.getMessage());
        }
    }

    private void submitAsync(Long execId, OrchFlow flow, OrchRunContext ctx, String el, String chainKey) {
        CompletableFuture.runAsync(() -> execute(execId, flow, ctx, el, chainKey), pool)
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

    /** 同步执行一段链（主段/恢复段/续跑段共用）。 */
    private OrchExec execute(Long execId, OrchFlow flow, OrchRunContext ctx, String el, String chainKey) {
        // 事件桥/引擎事务内创建的流水行可能尚未提交，短暂等待可见（最多 5s）
        OrchExec exec = null;
        for (int i = 0; i < 50 && exec == null; i++) {
            exec = execRepository.findById(execId).orElse(null);
            if (exec == null) {
                try {
                    Thread.sleep(100);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("执行被中断");
                }
            }
        }
        if (exec == null) {
            throw new IllegalStateException("执行流水行不可见(事务未提交或已回滚): " + execId);
        }
        try {
            String chainId = liteFlow.ensureChainKeyed(chainKey, el);
            LiteflowResponse resp = liteFlow.run(chainId, ctx);
            if (resp.isSuccess()) {
                if (ctx.waitNodeId != null) {
                    return suspend(exec, ctx); // §9.2 段终结于 wait → 挂起
                }
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
        } finally {
            // webhook 同步等待者兜底放行（respond 未执行/失败 → hooks 端点回退 202）
            CompletableFuture<Map<String, Object>> f = ctx.respondFuture;
            if (f != null && !f.isDone()) {
                f.complete(null);
            }
        }
        exec.setEndedAt(OffsetDateTime.now());
        exec.setContextSnapshot(snapshotJson(ctx, null, null));
        execRepository.save(exec);
        if (OrchExec.STATUS_FAILED.equals(exec.getStatus())) {
            triggerErrorFlow(flow, exec, ctx.payload);
        }
        return exec;
    }

    /** §9.2 挂起：WAITING + resume_token + 完整快照(waitNodeId/waitDeadline) + 超时定时器。 */
    private OrchExec suspend(OrchExec exec, OrchRunContext ctx) {
        JsonNode waitNode = ctx.node(ctx.waitNodeId);
        long timeoutMs = Math.max(1000, Math.min(
                waitNode.path("config").path("timeoutMs").asLong(WAIT_DEFAULT_MS), WAIT_MAX_MS));
        long deadline = System.currentTimeMillis() + timeoutMs;
        exec.setStatus(OrchExec.STATUS_WAITING);
        exec.setResumeToken(UUID.randomUUID().toString().replace("-", ""));
        exec.setContextSnapshot(snapshotJson(ctx, ctx.waitNodeId, deadline));
        execRepository.save(exec);
        waitManager.getObject().schedule(exec.getId(), deadline);
        log.info("编排挂起等待回调 exec={} node={} timeoutMs={}", exec.getId(), ctx.waitNodeId, timeoutMs);
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
            OrchExec errExec = createExec(errorFlow, errPayload, OrchExec.KIND_ERROR_FLOW, null);
            OrchRunContext errCtx = newCtx(errExec.getId(), errorFlow, errPayload, 0);
            submitAsync(errExec.getId(), errorFlow, errCtx, errorFlow.getElExpr(), mainChainKey(errorFlow));
        } catch (Exception e) {
            log.warn("错误工作流触发失败（不级联） flow={}: {}", flow.getCode(), e.getMessage());
        }
    }

    /** wait 节点留痕行收口（resume→SUCCESS / timeout→FAILED）。 */
    private void markWaitNodeRow(Long execId, String nodeId, boolean success, Object output, String error) {
        if (nodeId == null) {
            return;
        }
        try {
            execNodeRepository.findFirstByExecIdAndNodeIdOrderByIdDesc(execId, nodeId).ifPresent(row -> {
                row.setStatus(success ? OrchExecNode.STATUS_SUCCESS : OrchExecNode.STATUS_FAILED);
                row.setOutput(nodeLogger.truncate(output));
                row.setError(error);
                if (row.getStartedAt() != null) {
                    row.setCostMs(System.currentTimeMillis() - row.getStartedAt().toInstant().toEpochMilli());
                }
                execNodeRepository.save(row);
            });
        } catch (Exception e) {
            log.warn("wait 节点留痕收口失败 exec={} node={}: {}", execId, nodeId, e.getMessage());
        }
    }

    /** 完整上下文快照 JSON（不截断；waitNodeId/waitDeadline 仅挂起时携带）。 */
    private String snapshotJson(OrchRunContext ctx, String waitNodeId, Long waitDeadline) {
        try {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("payload", ctx.payload);
            m.put("vars", ctx.vars);
            m.put("outputs", ctx.outputs);
            m.put("failedNodes", new ArrayList<>(ctx.failedNodes));
            if (waitNodeId != null) {
                m.put("waitNodeId", waitNodeId);
                m.put("waitDeadline", waitDeadline);
            }
            return objectMapper.writeValueAsString(m);
        } catch (Exception e) {
            log.warn("上下文快照序列化失败: {}", e.getMessage());
            return null;
        }
    }

    private JsonNode parseSnapshot(String json) {
        try {
            return objectMapper.readTree(json == null ? "{}" : json);
        } catch (Exception e) {
            return objectMapper.createObjectNode();
        }
    }

    private JsonNode parseModel(String json) {
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            throw new BusinessException(400, "编排模型解析失败");
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> toMap(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return new LinkedHashMap<>();
        }
        try {
            return objectMapper.treeToValue(node, Map.class);
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    private List<String> toStrings(JsonNode arr) {
        List<String> out = new ArrayList<>();
        if (arr != null && arr.isArray()) {
            arr.forEach(n -> out.add(n.asString("")));
        }
        return out;
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
                e.getStatus(), e.getPayload(), e.getResult(), e.getError(), e.getStartedAt(), e.getEndedAt(),
                e.getResumeToken(), e.getCurrentSegment(), e.getParentExecId());
    }

    /** webhook 同步触发结果：respondFuture 为空 = 流不含 respond（走异步 202/200 语义由端点定）。 */
    public record WebhookRun(Long execId, CompletableFuture<Map<String, Object>> respondFuture, long syncTimeoutMs) {
    }
}
