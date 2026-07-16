package com.hentor.oa.boot.ai.managed;

import com.hentor.oa.boot.ai.service.AiActionService;
import com.hentor.oa.common.ai.AiManagedAction;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.CurrentUserHolder;
import com.hentor.oa.common.security.UserContext;
import jakarta.annotation.PostConstruct;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.lang.reflect.InvocationTargetException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 受控管理操作执行网关（AI 助手·受控管理操作框架，docs/design/ai-managed-actions.md §2/§5）。
 *
 * <p>作为动作草稿 {@code managed_action} 的确认执行器，在 {@code POST /api/ai/actions/{id}/confirm}
 * 的<b>确认请求线程</b>内被 {@link AiActionService} 调用（此时 UserContext = 确认者）：
 * <ol>
 *   <li><b>权限二次校验</b>（§5 权限继承）：requiredAuthority ⊆ 确认者权限，否则 403——即使伪造/越权提交，
 *       执行入口再挡一道（业务 Service 的 {@code @PreAuthorize} 在控制器层，反射直调 Service 绕不过它，
 *       故由框架在此补位）；</li>
 *   <li><b>字段限 schema</b>：表单值反序列化为绑定的请求 DTO（多余字段被 Jackson 丢弃，不能注入任意字段）；</li>
 *   <li><b>不绕校验</b>：对 DTO 跑 Bean Validation（@NotBlank/@NotNull 等，等价控制器 {@code @Valid}），
 *       再反射调真实业务 Service 方法（其事务/业务校验如唯一性天然生效）。</li>
 * </ol>
 * 全程只落在白名单描述符绑定的具体方法上，非通用 SQL / 万能 API。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiManagedGateway {

    /** 动作草稿 tool_name / 执行器键：所有受控管理操作共用一个执行器，按 payload.actionCode 分派。 */
    public static final String EXECUTOR = "managed_action";

    private final AiManagedActionRegistry registry;
    private final AiActionService actionService;
    private final ObjectMapper objectMapper;
    private final Validator validator;

    @PostConstruct
    public void registerExecutor() {
        actionService.registerExecutor(EXECUTOR, this::execute);
    }

    /**
     * 确认执行：params = {@code {actionCode, values, targetId?}}。返回业务 Service 结果（进 confirm 响应 data）。
     * 抛 {@link BusinessException} 以携带精确业务错误码（如 400 用户名已存在 / 403 无权）。
     */
    public Object execute(Map<String, Object> params) {
        String actionCode = params == null ? null : String.valueOf(params.get("actionCode"));
        AiManagedActionRegistry.ResolvedAction resolved = registry.get(actionCode);
        if (resolved == null) {
            throw new BusinessException(400, "未注册的管理操作: " + actionCode);
        }
        AiManagedAction action = resolved.action();

        // ① 权限二次校验（确认者上下文）
        UserContext user = CurrentUserHolder.get();
        if (user == null) {
            throw new BusinessException(401, "执行上下文缺失，拒绝执行");
        }
        if (!registry.hasAuthority(user, action.getRequiredAuthority())) {
            throw new BusinessException(403, "当前身份缺少权限「" + action.getRequiredAuthority()
                    + "」，无法执行" + action.getLabel());
        }

        // ② 表单值 → 请求 DTO（字段限 schema：多余键被丢弃）
        Object values = params.get("values");
        Object dto;
        try {
            dto = objectMapper.convertValue(values == null ? Map.of() : values, action.getRequestType());
        } catch (Exception e) {
            throw new BusinessException(400, "表单数据格式不正确: " + rootMessage(e));
        }

        // ③ Bean Validation（等价控制器 @Valid，Service 未重复标注时补位）
        Set<ConstraintViolation<Object>> violations = validator.validate(dto);
        if (!violations.isEmpty()) {
            String msg = violations.stream()
                    .map(ConstraintViolation::getMessage)
                    .distinct()
                    .collect(Collectors.joining("；"));
            throw new BusinessException(400, msg);
        }

        // ④ 反射调真实业务 Service 方法（其事务/业务唯一性校验生效）
        try {
            if (action.isUpdate()) {
                Long id = parseTargetId(params.get("targetId"));
                return resolved.method().invoke(action.getHandlerBean(), id, dto);
            }
            return resolved.method().invoke(action.getHandlerBean(), dto);
        } catch (InvocationTargetException ite) {
            Throwable cause = ite.getCause() != null ? ite.getCause() : ite;
            if (cause instanceof BusinessException be) {
                throw be; // 业务错误原样上抛（精确 code/message）
            }
            log.warn("AI 受控管理操作执行失败 {}: {}", actionCode, cause.getMessage());
            throw new BusinessException(500, "操作执行失败: " + cause.getMessage());
        } catch (IllegalAccessException e) {
            throw new BusinessException(500, "操作执行失败: " + e.getMessage());
        }
    }

    private Long parseTargetId(Object targetId) {
        if (targetId == null || String.valueOf(targetId).isBlank()) {
            throw new BusinessException(400, "编辑操作缺少目标 id");
        }
        try {
            return Long.valueOf(String.valueOf(targetId).trim());
        } catch (NumberFormatException e) {
            throw new BusinessException(400, "目标 id 非法: " + targetId);
        }
    }

    private String rootMessage(Throwable e) {
        Throwable c = e;
        while (c.getCause() != null && c.getCause() != c) {
            c = c.getCause();
        }
        return c.getMessage();
    }

    /** 供预填/构卡处调用，避免重复实现权限判定。 */
    public Map<String, Object> summarizeParams(AiManagedAction action, Map<String, Object> values, String targetId) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("actionCode", action.getActionCode());
        p.put("values", values == null ? Map.of() : values);
        if (targetId != null) {
            p.put("targetId", targetId);
        }
        return p;
    }
}
