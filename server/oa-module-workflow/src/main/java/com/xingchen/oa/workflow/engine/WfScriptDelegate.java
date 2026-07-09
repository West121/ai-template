package com.xingchen.oa.workflow.engine;

import com.xingchen.oa.workflow.engine.script.ScriptContext;
import com.xingchen.oa.workflow.engine.script.ScriptService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.flowable.bpmn.model.ExtensionElement;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 脚本节点（Tier 2）：serviceTask delegateExpression {@code ${wfScriptDelegate}}。
 * 由 {@code GraphToBpmnConverter} 对 {@code serviceTask{service.impl:"script", script:{lang,code}}} 生成，
 * 语言/脚本体存节点扩展元素 {@code oa:scriptLang} / {@code oa:scriptCode}。
 *
 * <p>运行时：读扩展元素 → 组装 {@link ScriptContext}（{@code vars}=当前流程变量可写视图、{@code form}=变量快照、
 * {@code execution}=当前执行体）→ 调 {@link ScriptService#run} → 把脚本对 {@code vars} 的增改回写为流程变量
 * （供后续排它/包容网关路由、表单）。脚本以应用完整权限运行，非沙箱（治理见 {@link ScriptService}）。
 */
@Slf4j
@Component("wfScriptDelegate")
@RequiredArgsConstructor
public class WfScriptDelegate implements JavaDelegate {

    private final RepositoryService repositoryService;
    private final ScriptService scriptService;

    @Override
    public void execute(DelegateExecution execution) {
        FlowElement fe = flowElement(execution);
        String lang = extText(fe, "scriptLang");
        String code = extText(fe, "scriptCode");
        if (lang == null || code == null) {
            log.warn("脚本节点缺少 scriptLang/scriptCode，跳过 pid={} node={}",
                    execution.getProcessInstanceId(), execution.getCurrentActivityId());
            return;
        }

        Map<String, Object> current = execution.getVariables();
        Map<String, Object> vars = current == null ? new HashMap<>() : new HashMap<>(current);
        Map<String, Object> form = current == null ? new HashMap<>() : new HashMap<>(current);
        String scriptRef = execution.getProcessDefinitionId() + "#" + execution.getCurrentActivityId();

        scriptService.run(lang, code, new ScriptContext(vars, form, execution, scriptRef));

        // 回写脚本对 vars 的增改为流程变量（影响后续网关/表单）
        for (Map.Entry<String, Object> e : vars.entrySet()) {
            Object before = current == null ? null : current.get(e.getKey());
            if (before == null ? e.getValue() != null : !before.equals(e.getValue())) {
                execution.setVariable(e.getKey(), e.getValue());
            }
        }
        log.info("脚本节点执行完成 pid={} node={} lang={}",
                execution.getProcessInstanceId(), execution.getCurrentActivityId(), lang);
    }

    private FlowElement flowElement(DelegateExecution execution) {
        try {
            return repositoryService.getBpmnModel(execution.getProcessDefinitionId())
                    .getMainProcess().getFlowElement(execution.getCurrentActivityId(), true);
        } catch (Exception e) {
            return null;
        }
    }

    private String extText(FlowElement fe, String name) {
        if (fe == null || fe.getExtensionElements() == null) {
            return null;
        }
        List<ExtensionElement> list = fe.getExtensionElements().get(name);
        if (list == null || list.isEmpty()) {
            return null;
        }
        String t = list.get(0).getElementText();
        return t == null || t.isBlank() ? null : t;
    }
}
