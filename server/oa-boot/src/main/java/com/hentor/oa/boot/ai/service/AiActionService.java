package com.hentor.oa.boot.ai.service;

import com.hentor.oa.boot.ai.entity.AiActionDraft;
import com.hentor.oa.boot.ai.repository.AiActionDraftRepository;
import com.hentor.oa.boot.ai.support.AiErrors;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.CurrentUserHolder;
import com.hentor.oa.common.security.UserContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.engine.TaskService;
import org.flowable.task.api.Task;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * 动作草稿服务（ai-assistant-design-v2.md §7，替换内存 AiConfirmService → PG 持久化）。
 *
 * <h3>状态机</h3>
 * {@code PENDING_CONFIRM → CONFIRMED → EXECUTING → SUCCEEDED|FAILED}，旁路 {@code CANCELLED / EXPIRED}。
 * 原子认领（{@link AiActionDraftRepository#claim}）保证双击/并发确认仅执行一次。
 *
 * <h3>确认执行校验（§7.3）</h3>
 * 归属（tenant+user）→ 状态 → 过期 → payload 哈希未变 → TOCTOU（任务类：Flowable 任务仍存在且
 * assignee 未变，否则 409 AI_ACTION_STALE，不静默按旧状态执行）→ 认领 → 执行器（确认请求线程内跑，
 * UserContext=确认者 → 底层 Service @PreAuthorize 权限/数据权限二验天然生效）。
 *
 * <h3>幂等</h3>
 * 确认携带 {@code Idempotency-Key}：首次执行落库该键 + 结果 JSON；同键重试直接重放原结果（仅执行一次）；
 * 无键/异键重试已执行动作 → 409 AI_ACTION_ALREADY_EXECUTED。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiActionService {

    private static final long TTL_MINUTES = 10;

    private final AiActionDraftRepository draftRepository;
    private final TaskService taskService;
    private final ObjectMapper objectMapper;

    /** toolName → 确认执行器（ChangeTools @PostConstruct 注册），返回执行结果（入 confirm 响应 data）。 */
    private final Map<String, Function<Map<String, Object>, Object>> executors = new ConcurrentHashMap<>();

    public void registerExecutor(String toolName, Function<Map<String, Object>, Object> executor) {
        executors.put(toolName, executor);
    }

    /** stage 目标快照（TOCTOU §7.4）：任务类动作在此登记 targetId/version/expectedStatus。 */
    public record Target(String type, String id, String version, String expectedStatus) {
    }

    // ==================== Stage（工具产确认卡时暂存） ====================

    /**
     * 持久化暂存动作草稿，返回 actionId（confirm 卡用）。10min 过期。
     * 任务类动作（target.type=task）在此快照 assignee，确认前比对。
     */
    public String stage(Long sessionId, Long sourceMessageId, String toolName, String actionType,
                        Map<String, Object> params, Target target) {
        UserContext ctx = CurrentUserHolder.get();
        if (ctx == null) {
            throw AiErrors.e(401, AiErrors.CONTEXT_MISSING, "执行上下文缺失，拒绝暂存动作");
        }
        AiActionDraft d = new AiActionDraft();
        d.setTenantId(AiErrors.TENANT_DEFAULT);
        d.setUserId(ctx.getUserId());
        d.setSessionId(sessionId);
        d.setSourceMessageId(sourceMessageId);
        d.setToolName(toolName);
        d.setActionType(actionType);
        String payloadJson = toJson(params);
        d.setPayloadJson(payloadJson);
        d.setPayloadHash(AiErrors.sha256(payloadJson));
        if (target != null) {
            d.setTargetType(target.type());
            d.setTargetId(target.id());
            d.setTargetVersion(target.version());
            d.setExpectedStatus(target.expectedStatus());
        }
        d.setRiskLevel(AiActionDraft.RISK_CONFIRM_REQUIRED);
        d.setStatus(AiActionDraft.STATUS_PENDING_CONFIRM);
        d.setExpiresAt(OffsetDateTime.now().plusMinutes(TTL_MINUTES));
        d = draftRepository.save(d);
        return String.valueOf(d.getId());
    }

    /** 任务类目标快照：任务当前 assignee（不存在 → version=null，确认时必 STALE）。 */
    public Target snapshotTask(String taskId) {
        Task task = taskService.createTaskQuery().taskId(taskId).singleResult();
        return new Target(AiActionDraft.TARGET_TASK, taskId,
                task == null ? null : String.valueOf(task.getAssignee()), "ACTIVE");
    }

    // ==================== Confirm / Cancel ====================

    /**
     * 确认执行（POST /api/ai/actions/{id}/confirm，Idempotency-Key 头，空 body）。
     * 全量校验见类注释；返回 {success,message,data}。
     */
    public Map<String, Object> confirm(Long actionId, String idempotencyKey) {
        AiActionDraft d = draftRepository.findById(actionId)
                .orElseThrow(() -> AiErrors.e(404, AiErrors.ACTION_NOT_FOUND, "确认动作不存在，请重新发起"));
        UserContext ctx = requireUser();
        if (!ctx.getUserId().equals(d.getUserId())) {
            throw new BusinessException(403, "该确认动作不属于当前用户");
        }
        // 幂等重放：同键 + 已成功 → 直接返回原结果，不再执行
        if (AiActionDraft.STATUS_SUCCEEDED.equals(d.getStatus())
                && StringUtils.hasText(idempotencyKey) && idempotencyKey.equals(d.getIdempotencyKey())) {
            return successBody(d, parseResult(d.getResultRef()), true);
        }
        switch (d.getStatus()) {
            case AiActionDraft.STATUS_PENDING_CONFIRM -> { /* 继续 */ }
            case AiActionDraft.STATUS_EXPIRED, AiActionDraft.STATUS_CANCELLED ->
                    throw AiErrors.e(410, AiErrors.ACTION_EXPIRED, "确认动作已取消或过期，请重新发起");
            default -> throw AiErrors.e(409, AiErrors.ACTION_ALREADY_EXECUTED, "该动作已执行过，不能重复确认");
        }
        // 过期懒标记
        if (d.getExpiresAt() != null && d.getExpiresAt().isBefore(OffsetDateTime.now())) {
            d.setStatus(AiActionDraft.STATUS_EXPIRED);
            d.setUpdatedAt(OffsetDateTime.now());
            draftRepository.save(d);
            throw AiErrors.e(410, AiErrors.ACTION_EXPIRED, "确认动作已过期（10 分钟），请重新发起");
        }
        // 参数哈希未变化（§7.3-8）
        if (!AiErrors.sha256(d.getPayloadJson()).equals(d.getPayloadHash())) {
            markFailed(d, AiErrors.ACTION_STALE, "动作参数哈希不一致");
            throw AiErrors.e(409, AiErrors.ACTION_STALE, "动作参数已变化，请重新发起");
        }
        // TOCTOU（§7.4）：任务类动作执行前比对 Flowable 任务仍存在且可办
        if (AiActionDraft.TARGET_TASK.equals(d.getTargetType()) && StringUtils.hasText(d.getTargetId())) {
            Task task = taskService.createTaskQuery().taskId(d.getTargetId()).singleResult();
            if (task == null) {
                markFailed(d, AiErrors.ACTION_STALE, "任务已被办理或不存在");
                throw AiErrors.e(409, AiErrors.ACTION_STALE, "该任务状态已经变化（已被办理或不存在），请重新查询后再操作");
            }
            if (d.getTargetVersion() != null && !d.getTargetVersion().equals(String.valueOf(task.getAssignee()))) {
                markFailed(d, AiErrors.ACTION_STALE, "任务办理人已变化");
                throw AiErrors.e(409, AiErrors.ACTION_STALE, "该任务办理人已变化，请重新查询后再操作");
            }
        }
        // 原子认领（双击并发防线）：PENDING_CONFIRM → CONFIRMED
        OffsetDateTime now = OffsetDateTime.now();
        if (draftRepository.claim(d.getId(), now, idempotencyKey) == 0) {
            AiActionDraft latest = draftRepository.findById(actionId).orElse(d);
            if (AiActionDraft.STATUS_SUCCEEDED.equals(latest.getStatus())
                    && StringUtils.hasText(idempotencyKey) && idempotencyKey.equals(latest.getIdempotencyKey())) {
                return successBody(latest, parseResult(latest.getResultRef()), true);
            }
            throw AiErrors.e(409, AiErrors.ACTION_ALREADY_EXECUTED, "该动作已被并发确认，不能重复执行");
        }
        // 认领后重载：拿到 claim 写入的 idempotency_key/version，避免用认领前快照覆盖回库
        d = draftRepository.findById(actionId).orElse(d);
        // 执行（确认请求线程内：UserContext=确认者 → 底层 Service 权限/数据权限/业务状态二验生效）
        Function<Map<String, Object>, Object> executor = executors.get(d.getToolName());
        if (executor == null) {
            markStatus(d, AiActionDraft.STATUS_FAILED, AiErrors.TOOL_NOT_ALLOWED, "无执行器: " + d.getToolName());
            throw new BusinessException(400, "该操作类型不支持确认执行: " + d.getToolName());
        }
        markStatus(d, AiActionDraft.STATUS_EXECUTING, null, null);
        try {
            Object data = executor.apply(parseParams(d.getPayloadJson()));
            d.setStatus(AiActionDraft.STATUS_SUCCEEDED);
            d.setExecutedAt(OffsetDateTime.now());
            d.setResultRef(toJson(data));
            d.setUpdatedAt(OffsetDateTime.now());
            draftRepository.save(d);
            log.info("AI action 执行成功 id={} tool={} user={}", d.getId(), d.getToolName(), ctx.getUserId());
            return successBody(d, data, false);
        } catch (BusinessException be) {
            markStatus(d, AiActionDraft.STATUS_FAILED, String.valueOf(be.getCode()), be.getMessage());
            throw be;
        } catch (Exception ex) {
            markStatus(d, AiActionDraft.STATUS_FAILED, "EXECUTE_ERROR", ex.getMessage());
            throw new BusinessException(500, "动作执行失败: " + ex.getMessage());
        }
    }

    /** 取消（POST /api/ai/actions/{id}/cancel）：仅 PENDING_CONFIRM 可取消。 */
    public Map<String, Object> cancel(Long actionId) {
        AiActionDraft d = draftRepository.findById(actionId)
                .orElseThrow(() -> AiErrors.e(404, AiErrors.ACTION_NOT_FOUND, "确认动作不存在"));
        UserContext ctx = requireUser();
        if (!ctx.getUserId().equals(d.getUserId())) {
            throw new BusinessException(403, "该确认动作不属于当前用户");
        }
        if (!AiActionDraft.STATUS_PENDING_CONFIRM.equals(d.getStatus())) {
            throw AiErrors.e(409, AiErrors.ACTION_ALREADY_EXECUTED, "动作已处理（" + d.getStatus() + "），不能取消");
        }
        markStatus(d, AiActionDraft.STATUS_CANCELLED, null, null);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("actionId", d.getId());
        out.put("status", AiActionDraft.STATUS_CANCELLED);
        return out;
    }

    /**
     * 旧 /api/ai/confirm 兼容代理（前端随后切新端点）：V1 语义=不存在/过期/已消费一律 410，他人动作 403。
     * actionId 非数字（V1 UUID 老卡片）→ 410。
     */
    public Map<String, Object> confirmLegacy(String actionId) {
        if (actionId == null || !actionId.matches("\\d+")) {
            throw new BusinessException(410, "确认操作不存在或已过期，请重新发起");
        }
        try {
            return confirm(Long.valueOf(actionId), null);
        } catch (BusinessException e) {
            if (e.getCode() == 404 || e.getCode() == 409 || e.getCode() == 410) {
                throw new BusinessException(410, "确认操作不存在或已过期，请重新发起");
            }
            throw e;
        }
    }

    // ==================== 内部 ====================

    private UserContext requireUser() {
        UserContext ctx = CurrentUserHolder.get();
        if (ctx == null) {
            throw AiErrors.e(401, AiErrors.CONTEXT_MISSING, "执行上下文缺失，拒绝执行");
        }
        return ctx;
    }

    private Map<String, Object> successBody(AiActionDraft d, Object data, boolean replayed) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("success", true);
        out.put("message", (d.getActionType() != null ? d.getActionType() + " " : "") + "已执行");
        out.put("actionId", d.getId());
        out.put("status", d.getStatus());
        out.put("replayed", replayed);
        out.put("data", data);
        return out;
    }

    private void markStatus(AiActionDraft d, String status, String errorCode, String errorMessage) {
        d.setStatus(status);
        d.setErrorCode(errorCode);
        d.setErrorMessage(errorMessage);
        d.setUpdatedAt(OffsetDateTime.now());
        draftRepository.save(d);
    }

    private void markFailed(AiActionDraft d, String errorCode, String errorMessage) {
        markStatus(d, AiActionDraft.STATUS_FAILED, errorCode, errorMessage);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseParams(String json) {
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    private Object parseResult(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return json;
        }
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            return "{}";
        }
    }
}
