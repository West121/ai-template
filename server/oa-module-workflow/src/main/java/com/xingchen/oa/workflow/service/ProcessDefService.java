package com.xingchen.oa.workflow.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.convert.JsonToBpmnConverter;
import com.xingchen.oa.workflow.dto.ProcessDefRequest;
import com.xingchen.oa.workflow.dto.ProcessDefResponse;
import com.xingchen.oa.workflow.entity.WfProcessExt;
import com.xingchen.oa.workflow.repository.WfProcessExtRepository;
import com.xingchen.oa.workflow.support.WfSupport;
import lombok.RequiredArgsConstructor;
import org.flowable.bpmn.converter.BpmnXMLConverter;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.repository.Deployment;
import org.flowable.engine.repository.ProcessDefinition;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;

/**
 * 流程定义档案 CRUD + 发布。发布时：
 * DINGTALK → JSON 转 BPMN；BPMN → 校验 XML；统一 repositoryService 部署（引擎 parse 失败即回滚拒绝）。
 */
@Service
@RequiredArgsConstructor
public class ProcessDefService {

    private final WfProcessExtRepository repository;
    private final JsonToBpmnConverter converter;
    private final RepositoryService repositoryService;
    private final ObjectMapper objectMapper;

    public PageResult<ProcessDefResponse> page(String keyword, int pageNum, int pageSize) {
        String kw = keyword == null ? "" : keyword;
        Page<WfProcessExt> page = repository.findByNameContainingOrDefCodeContaining(kw, kw,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        return new PageResult<>(page.getContent().stream().map(ProcessDefResponse::of).toList(),
                page.getTotalElements(), pageNum, pageSize);
    }

    public ProcessDefResponse get(Long id) {
        return ProcessDefResponse.of(find(id));
    }

    public ProcessDefResponse latest(String defCode) {
        return repository.findByDefCode(defCode).map(ProcessDefResponse::of)
                .orElseThrow(() -> new BusinessException(404, "流程定义不存在: " + defCode));
    }

    public String diagramXml(String defCode) {
        WfProcessExt e = repository.findByDefCode(defCode)
                .orElseThrow(() -> new BusinessException(404, "流程定义不存在: " + defCode));
        return e.getBpmnXml();
    }

    @Transactional
    public ProcessDefResponse create(ProcessDefRequest req) {
        if (repository.findByDefCode(req.defCode()).isPresent()) {
            throw new BusinessException(400, "流程编码已存在: " + req.defCode());
        }
        WfProcessExt e = new WfProcessExt();
        e.setDefCode(req.defCode());
        apply(e, req);
        e.setStatus(WfProcessExt.STATUS_DRAFT);
        e.setCreatedBy(WfSupport.currentUser().getUserId());
        return ProcessDefResponse.of(repository.save(e));
    }

    @Transactional
    public ProcessDefResponse update(Long id, ProcessDefRequest req) {
        WfProcessExt e = find(id);
        apply(e, req);
        return ProcessDefResponse.of(repository.save(e));
    }

    private void apply(WfProcessExt e, ProcessDefRequest req) {
        e.setName(req.name());
        e.setCategory(req.category());
        e.setIcon(req.icon());
        e.setFormCode(req.formCode());
        e.setFormVersion(req.formVersion());
        if (StringUtils.hasText(req.designerType())) {
            e.setDesignerType(req.designerType());
        }
        e.setDesignerJson(req.designerJson());
        if (StringUtils.hasText(req.bpmnXml())) {
            e.setBpmnXml(req.bpmnXml());
        }
        e.setRemark(req.remark());
        // P1-C：自定义表单 + 流程级配置（formType 缺省保持 DYNAMIC）
        if (StringUtils.hasText(req.formType())) {
            e.setFormType(req.formType());
        }
        e.setFormSubmitPath(req.formSubmitPath());
        e.setFormViewPath(req.formViewPath());
        e.setFlowConfig(req.flowConfig());
    }

    /** 发布：转换/校验 → 部署。 */
    @Transactional
    public ProcessDefResponse publish(Long id) {
        WfProcessExt e = find(id);
        deploy(e);
        return ProcessDefResponse.of(repository.save(e));
    }

    /** 供初始化器复用：对给定档案执行转换 + 部署，回填部署元数据。 */
    @Transactional
    public void deploy(WfProcessExt e) {
        String formKey = StringUtils.hasText(e.getFormCode())
                ? e.getFormCode() + ":" + (e.getFormVersion() == null ? 1 : e.getFormVersion())
                : null;
        Deployment deployment;
        try {
            if (WfProcessExt.TYPE_BPMN.equals(e.getDesignerType())) {
                if (!StringUtils.hasText(e.getBpmnXml())) {
                    throw new BusinessException(400, "BPMN 流程缺少 bpmnXml");
                }
                deployment = repositoryService.createDeployment()
                        .name(e.getName())
                        .key(e.getDefCode())
                        .addString(e.getDefCode() + ".bpmn20.xml", e.getBpmnXml())
                        .deploy();
            } else {
                JsonNode root = objectMapper.readTree(
                        StringUtils.hasText(e.getDesignerJson()) ? e.getDesignerJson() : "{\"nodes\":[]}");
                BpmnModel model = converter.convert(e.getDefCode(), e.getName(), formKey, root);
                byte[] xml = new BpmnXMLConverter().convertToXML(model);
                e.setBpmnXml(new String(xml, StandardCharsets.UTF_8));
                deployment = repositoryService.createDeployment()
                        .name(e.getName())
                        .key(e.getDefCode())
                        .addBpmnModel(e.getDefCode() + ".bpmn20.xml", model)
                        .deploy();
            }
        } catch (BusinessException be) {
            throw be;
        } catch (Exception ex) {
            throw new BusinessException(400, "流程发布失败（BPMN 解析/部署错误）：" + ex.getMessage());
        }
        ProcessDefinition pd = repositoryService.createProcessDefinitionQuery()
                .deploymentId(deployment.getId()).singleResult();
        e.setLatestDeploymentId(deployment.getId());
        e.setProcessDefinitionId(pd != null ? pd.getId() : null);
        e.setStatus(WfProcessExt.STATUS_PUBLISHED);
    }

    private WfProcessExt find(Long id) {
        return repository.findById(id).orElseThrow(() -> new BusinessException(404, "流程定义不存在"));
    }
}
