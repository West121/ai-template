package com.xingchen.oa.boot.ai.managed;

import com.xingchen.oa.common.ai.AiManagedAction;
import com.xingchen.oa.common.ai.AiManagedActionProvider;
import com.xingchen.oa.common.ai.ManagedActionKind;
import com.xingchen.oa.common.security.UserContext;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 受控管理操作注册表（AI 助手·受控管理操作框架，docs/design/ai-managed-actions.md §1）。
 *
 * <p>启动时收集全部 {@link AiManagedActionProvider} bean 暴露的 {@link AiManagedAction} 描述符，按 actionCode
 * 建表，并把每个描述符的 handler 方法反射解析并缓存（CREATE→{@code method(requestType)}，
 * UPDATE→{@code method(Long,requestType)}），启动即暴露绑定错误，不拖到运行期。
 *
 * <p>新业务只要新增一个 provider bean → 这里自动收录 → 三个通用工具立即可用（不改 AI 核心）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiManagedActionRegistry {

    /** Spring 收集所有模块的 provider bean（含 boot 侧集中声明的 system 描述符）。 */
    private final List<AiManagedActionProvider> providers;

    private final Map<String, ResolvedAction> actions = new LinkedHashMap<>();

    /** 描述符 + 已解析的 handler 反射方法。 */
    public record ResolvedAction(AiManagedAction action, Method method) {
    }

    @PostConstruct
    public void scan() {
        for (AiManagedActionProvider provider : providers) {
            List<AiManagedAction> list = provider.managedActions();
            if (list == null) {
                continue;
            }
            for (AiManagedAction a : list) {
                register(a);
            }
        }
        log.info("AI 受控管理操作注册完成：{} 个 [{}]", actions.size(), String.join(", ", actions.keySet()));
    }

    private void register(AiManagedAction a) {
        if (a == null || a.getActionCode() == null) {
            return;
        }
        if (actions.containsKey(a.getActionCode())) {
            log.warn("AI 受控管理操作 actionCode 重复，忽略后者: {}", a.getActionCode());
            return;
        }
        Method method = resolveHandler(a);
        if (method == null) {
            return; // 绑定失败已记日志，不注册（宁缺毋滥，避免运行期 NoSuchMethod）
        }
        actions.put(a.getActionCode(), new ResolvedAction(a, method));
    }

    private Method resolveHandler(AiManagedAction a) {
        if (a.getHandlerBean() == null || a.getHandlerMethod() == null || a.getRequestType() == null) {
            log.warn("AI 受控管理操作 {} handler 绑定不完整，跳过", a.getActionCode());
            return null;
        }
        Class<?>[] params = a.getAction() == ManagedActionKind.UPDATE
                ? new Class<?>[]{Long.class, a.getRequestType()}
                : new Class<?>[]{a.getRequestType()};
        try {
            return a.getHandlerBean().getClass().getMethod(a.getHandlerMethod(), params);
        } catch (NoSuchMethodException e) {
            log.warn("AI 受控管理操作 {} 无法解析 handler 方法 {}{}: {}", a.getActionCode(),
                    a.getHandlerMethod(), java.util.Arrays.toString(params), e.getMessage());
            return null;
        }
    }

    public ResolvedAction get(String actionCode) {
        return actionCode == null ? null : actions.get(actionCode);
    }

    /**
     * 当前用户「有权」的操作（{@link AiManagedAction#getRequiredAuthority()} ⊆ 用户权限；
     * permissions==null 为离线 allow-all，与 hasPerm 口径一致），按 keyword/module 过滤。红线：无权不暴露。
     */
    public List<AiManagedAction> listAuthorized(UserContext user, String keyword, String module) {
        List<AiManagedAction> out = new ArrayList<>();
        for (ResolvedAction ra : actions.values()) {
            AiManagedAction a = ra.action();
            if (!hasAuthority(user, a.getRequiredAuthority())) {
                continue;
            }
            if (module != null && !module.isBlank() && !module.equalsIgnoreCase(a.getModule())) {
                continue;
            }
            if (keyword != null && !keyword.isBlank() && !matchesKeyword(a, keyword.trim())) {
                continue;
            }
            out.add(a);
        }
        return out;
    }

    /** 功能权限判定：离线（permissions==null）放行；空权限码放行；否则必须持有。 */
    public boolean hasAuthority(UserContext user, String authority) {
        if (authority == null || authority.isBlank()) {
            return true;
        }
        if (user == null) {
            return false;
        }
        List<String> perms = user.getPermissions();
        return perms == null || perms.contains(authority);
    }

    private boolean matchesKeyword(AiManagedAction a, String keyword) {
        return contains(a.getLabel(), keyword) || contains(a.getEntityLabel(), keyword)
                || contains(a.getActionCode(), keyword) || contains(a.getModule(), keyword);
    }

    private boolean contains(String text, String keyword) {
        return text != null && text.toLowerCase().contains(keyword.toLowerCase());
    }
}
