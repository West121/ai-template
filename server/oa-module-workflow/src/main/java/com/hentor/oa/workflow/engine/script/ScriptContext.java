package com.hentor.oa.workflow.engine.script;

import org.flowable.engine.delegate.DelegateExecution;

import java.util.HashMap;
import java.util.Map;

/**
 * Tier 2 脚本执行上下文：注入到脚本绑定的一等变量（{@code vars} / {@code form} / {@code execution}）。
 * 门面变量（{@code spring} / {@code log}）不在此，而是由 {@link ScriptService} 从 LiteFlow
 * {@code ScriptBeanManager} 全局脚本 bean 表统一并入（对应 {@code @ScriptBean} 注册项）。
 *
 * <ul>
 *   <li>{@link #vars} —— 流程变量读写视图（可变 Map）。脚本对其增删改，运行时由 {@code wfScriptDelegate}
 *       回写 {@link DelegateExecution} 变量，从而影响后续网关路由 / 表单。</li>
 *   <li>{@link #form} —— 表单数据（一般为只读快照的可变副本）。</li>
 *   <li>{@link #execution} —— 当前 Flowable 执行体，<b>可空</b>（测试运行端点无引擎上下文时为 null）。</li>
 *   <li>{@link #scriptRef} —— 审计用脚本标识（scriptTask=&lt;procDefId&gt;#&lt;nodeId&gt;；测试运行=test-run）。</li>
 * </ul>
 */
public class ScriptContext {

    public final Map<String, Object> vars;
    public final Map<String, Object> form;
    public final DelegateExecution execution;
    public final String scriptRef;

    public ScriptContext(Map<String, Object> vars, Map<String, Object> form,
                         DelegateExecution execution, String scriptRef) {
        this.vars = vars == null ? new HashMap<>() : vars;
        this.form = form == null ? new HashMap<>() : form;
        this.execution = execution;
        this.scriptRef = scriptRef;
    }

    /** 测试运行 / 无引擎上下文场景：仅提供样例变量。 */
    public static ScriptContext ofVars(Map<String, Object> vars, String scriptRef) {
        return new ScriptContext(vars, new HashMap<>(), null, scriptRef);
    }
}
