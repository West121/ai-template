package com.xingchen.oa.boot.devstudio.adapter;

import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.AssetContent;
import com.xingchen.oa.boot.devstudio.dto.DevStudioDtos.AssetNode;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.convert.GraphToBpmnConverter;
import com.xingchen.oa.workflow.convert.JsonToBpmnConverter;
import com.xingchen.oa.workflow.dto.ProcessDefRequest;
import com.xingchen.oa.workflow.entity.WfProcessExt;
import com.xingchen.oa.workflow.repository.WfProcessExtRepository;
import com.xingchen.oa.workflow.service.ProcessDefService;
import lombok.RequiredArgsConstructor;
import org.flowable.bpmn.converter.BpmnXMLConverter;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.common.engine.api.io.InputStreamProvider;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import tools.jackson.databind.ObjectMapper;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * PROCESS（流程定义 wf_process_ext）适配。
 *
 * <p><b>安全硬线（拍板 8-①，历史教训：坏 designerJson 会让 WorkflowInitializer 启动部署失败 →
 * 整个应用起不来）</b>：保存与发布<b>一律先干跑转换校验</b>——GRAPH 走 {@link GraphToBpmnConverter}、
 * DINGTALK 走 {@link JsonToBpmnConverter}、BPMN 走 {@link BpmnXMLConverter} 解析；失败 400 拒绝，
 * <b>坏内容不落库</b>（WorkflowInitializer 启动会部署全部 DRAFT，故草稿也必须过干跑）。
 *
 * <p>content 口径：designerType=BPMN → bpmn_xml；GRAPH/DINGTALK → designer_json。
 * 发布=ProcessDefService.publish（引擎真部署，失败 400 事务回滚）。
 */
@Component
@RequiredArgsConstructor
public class ProcessAssetAdapter implements DevAssetAdapter {

    private final WfProcessExtRepository repository;
    private final ProcessDefService processDefService;
    private final GraphToBpmnConverter graphConverter;
    private final JsonToBpmnConverter jsonConverter;
    private final ObjectMapper objectMapper;

    @Override
    public String type() {
        return "PROCESS";
    }

    @Override
    public String writeAuthority() {
        return "wf:def:edit";
    }

    @Override
    public List<AssetNode> list() {
        List<AssetNode> out = new ArrayList<>();
        for (WfProcessExt e : repository.findAll()) {
            out.add(new AssetNode(type(), e.getDefCode(), e.getName(), e.getStatus(),
                    deployedVersion(e.getProcessDefinitionId()), e.getCreatedAt()));
        }
        return out;
    }

    @Override
    public AssetContent read(String code) {
        WfProcessExt e = find(code);
        boolean bpmn = WfProcessExt.TYPE_BPMN.equals(e.getDesignerType());
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("id", e.getId());
        meta.put("name", e.getName());
        meta.put("status", e.getStatus());
        meta.put("nativeVersion", deployedVersion(e.getProcessDefinitionId()));
        meta.put("designerType", e.getDesignerType());
        meta.put("formCode", e.getFormCode());
        meta.put("formVersion", e.getFormVersion());
        meta.put("formType", WfProcessExt.canonicalFormType(e.getFormType()));
        meta.put("category", e.getCategory());
        meta.put("processDefinitionId", e.getProcessDefinitionId());
        return new AssetContent(type(), code, bpmn ? e.getBpmnXml() : e.getDesignerJson(), null, meta);
    }

    @Override
    public Map<String, Object> save(String code, String content, boolean publish) {
        WfProcessExt e = find(code);
        boolean bpmn = WfProcessExt.TYPE_BPMN.equals(e.getDesignerType());
        dryRunConvert(e, content); // 硬线：草稿也干跑（启动器会部署全部 DRAFT）
        return doSave(e, bpmn, content, publish);
    }

    @Override
    public void validate(String code, String content) {
        dryRunConvert(find(code), content);
    }

    private Map<String, Object> doSave(WfProcessExt e, boolean bpmn, String content, boolean publish) {
        String code = e.getDefCode();
        // 以现值回填全部字段，仅替换本次编辑的内容列（ProcessDefService.apply 对 name 等无条件覆盖）
        ProcessDefRequest req = new ProcessDefRequest(
                e.getDefCode(), e.getName(), e.getCategory(), e.getIcon(),
                e.getFormCode(), e.getFormVersion(), e.getDesignerType(),
                bpmn ? e.getDesignerJson() : content,
                bpmn ? content : e.getBpmnXml(),
                e.getRemark(), e.getFormType(), e.getFormSubmitPath(), e.getFormViewPath(), e.getFlowConfig());
        processDefService.update(e.getId(), req);
        if (publish) {
            processDefService.publish(e.getId()); // 引擎真部署，parse 失败 400 → 事务回滚
        }
        WfProcessExt after = find(code);
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("nativeVersion", deployedVersion(after.getProcessDefinitionId()));
        meta.put("status", after.getStatus());
        meta.put("designerType", after.getDesignerType());
        meta.put("processDefinitionId", after.getProcessDefinitionId());
        if (publish) {
            meta.put("deployed", true);
        }
        return meta;
    }

    /** 干跑转换（不落库不部署）：GRAPH/DINGTALK 转 BpmnModel + 序列化 XML；BPMN 解析 XML。失败 400。 */
    private void dryRunConvert(WfProcessExt e, String content) {
        try {
            if (WfProcessExt.TYPE_BPMN.equals(e.getDesignerType())) {
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                InputStreamProvider provider = () -> new ByteArrayInputStream(bytes);
                new BpmnXMLConverter().convertToBpmnModel(provider, false, false);
            } else if (WfProcessExt.TYPE_GRAPH.equals(e.getDesignerType())) {
                BpmnModel model = graphConverter.graphToBpmn(objectMapper.readTree(content));
                new BpmnXMLConverter().convertToXML(model);
            } else { // DINGTALK
                String formKey = StringUtils.hasText(e.getFormCode())
                        ? e.getFormCode() + ":" + (e.getFormVersion() == null ? 1 : e.getFormVersion())
                        : null;
                BpmnModel model = jsonConverter.convert(e.getDefCode(), e.getName(), formKey,
                        objectMapper.readTree(content));
                new BpmnXMLConverter().convertToXML(model);
            }
        } catch (BusinessException be) {
            throw new BusinessException(400, "流程内容干跑校验失败（未保存）：" + be.getMessage());
        } catch (Exception ex) {
            throw new BusinessException(400, "流程内容干跑校验失败（未保存）：" + ex.getMessage());
        }
    }

    /** processDefinitionId 形如 {@code key:version:uuid} → 取部署版本号；无/异常 → null。 */
    private Integer deployedVersion(String processDefinitionId) {
        if (!StringUtils.hasText(processDefinitionId)) {
            return null;
        }
        String[] parts = processDefinitionId.split(":");
        if (parts.length < 2) {
            return null;
        }
        try {
            return Integer.valueOf(parts[1]);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private WfProcessExt find(String code) {
        return repository.findByDefCode(code)
                .orElseThrow(() -> new BusinessException(404, "流程定义不存在: " + code));
    }
}
