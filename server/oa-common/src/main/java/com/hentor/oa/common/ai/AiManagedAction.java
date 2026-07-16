package com.hentor.oa.common.ai;

import lombok.Builder;
import lombok.Getter;

import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * 受控管理操作描述符（AI 助手·受控管理操作框架，docs/design/ai-managed-actions.md §1）。
 *
 * <p><b>白名单预注册模式</b>：每个可被 AI 助手执行的管理写操作，都由业务模块以描述符形式声明。
 * AI 侧（boot 的 {@code AiManagedActionRegistry}）在启动时收集所有 {@link AiManagedActionProvider}
 * 暴露的描述符 → 三个通用工具（manage_list_actions / manage_prepare / manage_submit）即自动可用，
 * <b>无需为每个业务写工具、也无需改 AI 核心</b>。
 *
 * <p><b>依赖方向</b>：本描述符与 {@link AiManagedActionProvider} 均放在 oa-common，业务模块只依赖 common
 * 即可自注册，<b>不反向依赖 boot / ai 注解</b>（system 模块保持零 AI 依赖，其描述符由 boot 侧 provider 集中声明）。
 *
 * <p><b>安全红线</b>（§5）：
 * <ol>
 *   <li>操作是预注册白名单，AI 只能在名单内选，字段限 {@link #formSchema}（不能注入任意字段/SQL）；</li>
 *   <li>{@link #requiredAuthority} 权限继承：{@code ⊆ 当前用户权限} 才对模型暴露、才允许提交/执行；</li>
 *   <li>{@link #handlerBean}/{@link #handlerMethod} 绑定真实业务 Service 方法（反射调用，走其事务/业务校验），
 *       Gateway 另做 bean 校验 + 权限二次校验（Service 层未标 {@code @PreAuthorize} 时由框架补位）；</li>
 *   <li>删除/改权限/重置密码等高危动作首期<b>不注册</b>（风险 PROHIBITED）。</li>
 * </ol>
 */
@Getter
@Builder
public class AiManagedAction {

    /** 表单卡提交即授权、直接执行（暂未用于批 M1）。 */
    public static final String RISK_EXPLICIT_UI_SUBMIT = "EXPLICIT_UI_SUBMIT";
    /** 表单卡 → 确认卡二段式 → 动作草稿状态机执行（批 M1 组织人事一律用此）。 */
    public static final String RISK_CONFIRM_REQUIRED = "CONFIRM_REQUIRED";

    /** 全局唯一操作码，如 {@code system.user.create} / {@code system.dept.update}。 */
    private final String actionCode;

    /** 所属模块，如 {@code system} / {@code office} / {@code workflow}。 */
    private final String module;

    /** 实体人话名，如「用户」「部门」「角色」「岗位」。 */
    private final String entityLabel;

    /** 动作种类 CREATE / UPDATE。 */
    private final ManagedActionKind action;

    /** 动作人话名，如「新增用户」「编辑部门」。 */
    private final String label;

    /**
     * 表单 schema：复用前端 form-renderer 的 widgets 数组（{@code List<Map<String,Object>>}），
     * 每项至少含 {@code type/key/label}，选项型带 {@code options:[{label,value}]}，必填带 {@code required:true}。
     * manage_prepare 直接把它放进表单卡 {@code card.schema}（前端 FormRenderer 渲染）。
     */
    private final Object formSchema;

    /** 功能权限码（如 {@code system:user:edit}）。空 = 登录即可（不建议用于写操作）。 */
    private final String requiredAuthority;

    /** 风险等级（见常量）。批 M1 一律 {@link #RISK_CONFIRM_REQUIRED}。 */
    @Builder.Default
    private final String risk = RISK_CONFIRM_REQUIRED;

    /** 绑定的业务 Service bean（Spring 代理，反射调用时其 {@code @Transactional}/校验生效）。 */
    private final Object handlerBean;

    /**
     * 绑定的方法名。CREATE 期望签名 {@code method(requestType)}；
     * UPDATE 期望签名 {@code method(Long id, requestType)}。
     */
    private final String handlerMethod;

    /** 表单值反序列化目标（业务请求 DTO，如 {@code UserCreateRequest.class}）。 */
    private final Class<?> requestType;

    /**
     * UPDATE 现值加载器（可空）：{@code targetId → 字段值 Map}（键对齐 {@link #formSchema} 的 widget key）。
     * manage_prepare 对 UPDATE 用它预填表单卡，用户在现值基础上改。
     */
    private final Function<String, Map<String, Object>> updateLoader;

    public boolean isUpdate() {
        return action == ManagedActionKind.UPDATE;
    }

    /** 表单 schema 作为 widgets 列表返回（非列表 → 空列表，防御）。 */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> schemaWidgets() {
        return formSchema instanceof List<?> list ? (List<Map<String, Object>>) list : List.of();
    }
}
