package com.xingchen.oa.workflow.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.convert.BpmnToGraphConverter;
import com.xingchen.oa.workflow.convert.GraphToBpmnConverter;
import com.xingchen.oa.workflow.convert.JsonToBpmnConverter;
import com.xingchen.oa.workflow.dto.BpmnImportResult;
import com.xingchen.oa.workflow.dto.GraphDeployRequest;
import com.xingchen.oa.workflow.dto.GraphDeployResponse;
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
import tools.jackson.databind.node.ObjectNode;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 流程定义档案 CRUD + 发布。发布时：
 * DINGTALK → JSON 转 BPMN；BPMN → 校验 XML；统一 repositoryService 部署（引擎 parse 失败即回滚拒绝）。
 */
@Service
@RequiredArgsConstructor
public class ProcessDefService {

    private final WfProcessExtRepository repository;
    private final JsonToBpmnConverter converter;
    private final GraphToBpmnConverter graphConverter;
    private final BpmnToGraphConverter bpmnToGraphConverter;
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
            if (WfProcessExt.TYPE_GRAPH.equals(e.getDesignerType())) {
                // 图直译路径（切片 2a）：designer_json 存归一化 ProcessModel，经 GraphToBpmnConverter 直译。
                if (!StringUtils.hasText(e.getDesignerJson())) {
                    throw new BusinessException(400, "图流程缺少 ProcessModel(designerJson)");
                }
                JsonNode root = objectMapper.readTree(e.getDesignerJson());
                BpmnModel model = graphConverter.graphToBpmn(root);
                byte[] xml = new BpmnXMLConverter().convertToXML(model);
                e.setBpmnXml(new String(xml, StandardCharsets.UTF_8));
                deployment = repositoryService.createDeployment()
                        .name(e.getName())
                        .key(e.getDefCode())
                        .addBpmnModel(e.getDefCode() + ".bpmn20.xml", model)
                        .deploy();
            } else if (WfProcessExt.TYPE_BPMN.equals(e.getDesignerType())) {
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

    /**
     * 图直译一站式部署（切片 2a）：接受前端归一化 {@link com.xingchen.oa.workflow.convert.graph.ProcessModel} JSON，
     * 经 {@link GraphToBpmnConverter} 转 {@link BpmnModel}，走与旧路径完全相同的 Flowable 部署与 wf_process_ext 落库。
     *
     * <p>与旧「先建档 → 再发布」两步流程并存：本端点一步完成 upsert(by defCode) + 转换 + 部署 + 回填。
     * defCode 取请求 {@code key}，并归一化写入 model.key/name 保证 BPMN process id == defCode
     *（否则 startProcessInstanceByKey 找不到 key）。
     */
    @Transactional
    public GraphDeployResponse deployGraph(GraphDeployRequest req) {
        if (!StringUtils.hasText(req.key())) {
            throw new BusinessException(400, "缺少流程 key");
        }
        if (req.model() == null || req.model().isMissingNode() || req.model().isNull()) {
            throw new BusinessException(400, "缺少 ProcessModel(model)");
        }
        // 归一化：以顶层 key/name 为准写回 model，保证 process id == defCode
        JsonNode model = req.model();
        if (model instanceof ObjectNode obj) {
            obj.put("key", req.key());
            if (StringUtils.hasText(req.name())) {
                obj.put("name", req.name());
            }
        }

        WfProcessExt e = repository.findByDefCode(req.key()).orElseGet(() -> {
            WfProcessExt ne = new WfProcessExt();
            ne.setDefCode(req.key());
            ne.setCreatedBy(WfSupport.currentUser().getUserId());
            return ne;
        });
        e.setName(StringUtils.hasText(req.name()) ? req.name() : req.key());
        e.setDesignerType(WfProcessExt.TYPE_GRAPH);
        e.setDesignerJson(model.toString());
        if (StringUtils.hasText(req.formCode())) {
            e.setFormCode(req.formCode());
        }
        if (req.formVersion() != null) {
            e.setFormVersion(req.formVersion());
        }
        if (StringUtils.hasText(req.category())) {
            e.setCategory(req.category());
        }
        if (StringUtils.hasText(req.icon())) {
            e.setIcon(req.icon());
        }

        deploy(e);
        repository.save(e);

        ProcessDefinition pd = repositoryService.createProcessDefinitionQuery()
                .processDefinitionId(e.getProcessDefinitionId()).singleResult();
        return new GraphDeployResponse(
                e.getId(),
                e.getProcessDefinitionId(),
                pd != null ? pd.getKey() : e.getDefCode(),
                pd != null ? pd.getVersion() : null,
                e.getLatestDeploymentId(),
                e.getStatus());
    }

    /**
     * 导出流程定义存档的 {@code .bpmn} XML（{@code GET /api/wf/models/{id}/bpmn}，N-B-02 附录 B「.bpmn 往返」）。
     *
     * <p>优先返回已存 {@code bpmn_xml}；若为 GRAPH 老数据只存 designer_json（归一化 ProcessModel）而无 xml，
     * 则现转：designerJson → {@link GraphToBpmnConverter} → {@link BpmnModel} → {@link BpmnXMLConverter} 出 XML
     *（只读，不落库）。DINGTALK 老数据无 xml 时同理经 {@link JsonToBpmnConverter} 现转。
     */
    public String exportBpmn(Long id) {
        WfProcessExt e = find(id);
        if (StringUtils.hasText(e.getBpmnXml())) {
            return e.getBpmnXml();
        }
        BpmnModel model;
        try {
            if (WfProcessExt.TYPE_GRAPH.equals(e.getDesignerType())) {
                if (!StringUtils.hasText(e.getDesignerJson())) {
                    throw new BusinessException(400, "图流程缺少 ProcessModel(designerJson)，无法导出 .bpmn");
                }
                model = graphConverter.graphToBpmn(objectMapper.readTree(e.getDesignerJson()));
            } else if (WfProcessExt.TYPE_DINGTALK.equals(e.getDesignerType()) && StringUtils.hasText(e.getDesignerJson())) {
                String formKey = StringUtils.hasText(e.getFormCode())
                        ? e.getFormCode() + ":" + (e.getFormVersion() == null ? 1 : e.getFormVersion())
                        : null;
                model = converter.convert(e.getDefCode(), e.getName(), formKey, objectMapper.readTree(e.getDesignerJson()));
            } else {
                throw new BusinessException(400, "该流程定义无 bpmn_xml，且无可现转的 designerJson");
            }
        } catch (BusinessException be) {
            throw be;
        } catch (Exception ex) {
            throw new BusinessException(400, ".bpmn 导出转换失败：" + ex.getMessage());
        }
        return new String(new BpmnXMLConverter().convertToXML(model), StandardCharsets.UTF_8);
    }

    /**
     * 导入 {@code .bpmn} XML（{@code POST /api/wf/models/import}，N-B-02）：Flowable
     * {@code BpmnXMLConverter.convertToBpmnModel} → {@link BpmnToGraphConverter} 逆向还原为
     * {@link com.xingchen.oa.workflow.convert.graph.ProcessModel}，供前端 react-flow 载入。<b>不落库、不部署</b>——
     * 仅返回模型供前端编辑后再走 {@code /graph/deploy}。warnings 承载未完全还原/缺 DI 提示。
     */
    public BpmnImportResult importBpmn(String xml) {
        List<String> warnings = new ArrayList<>();
        return new BpmnImportResult(bpmnToGraphConverter.importXml(xml, warnings), warnings);
    }

    private WfProcessExt find(Long id) {
        return repository.findById(id).orElseThrow(() -> new BusinessException(404, "流程定义不存在"));
    }
}
