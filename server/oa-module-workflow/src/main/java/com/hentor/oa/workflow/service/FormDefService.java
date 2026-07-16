package com.hentor.oa.workflow.service;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.workflow.dto.FormDefRequest;
import com.hentor.oa.workflow.dto.FormDefResponse;
import com.hentor.oa.workflow.dto.FormRecordResponse;
import com.hentor.oa.workflow.entity.WfFormDef;
import com.hentor.oa.workflow.entity.WfInstanceExt;
import com.hentor.oa.workflow.repository.WfFormDefRepository;
import com.hentor.oa.workflow.repository.WfInstanceExtRepository;
import com.hentor.oa.workflow.support.WfSupport;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 表单定义：CRUD + 发布 + 版本。code+version 唯一；PUBLISHED 不可改，修改=同 code 新版本 DRAFT。
 */
@Service
@RequiredArgsConstructor
public class FormDefService {

    private final WfFormDefRepository repository;
    private final WfInstanceExtRepository instanceRepository;
    private final ObjectMapper objectMapper;

    public PageResult<FormDefResponse> page(String keyword, int pageNum, int pageSize) {
        String kw = keyword == null ? "" : keyword;
        Page<WfFormDef> page = repository.findByNameContainingOrCodeContaining(kw, kw,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "id")));
        return new PageResult<>(page.getContent().stream().map(FormDefResponse::of).toList(),
                page.getTotalElements(), pageNum, pageSize);
    }

    public FormDefResponse get(Long id) {
        return FormDefResponse.of(find(id));
    }

    public FormDefResponse latest(String code) {
        return repository.findTopByCodeOrderByVersionDesc(code)
                .map(FormDefResponse::of)
                .orElseThrow(() -> new BusinessException(404, "表单定义不存在: " + code));
    }

    public List<FormDefResponse> versions(String code) {
        return repository.findByCodeOrderByVersionDesc(code).stream().map(FormDefResponse::of).toList();
    }

    /** 新建：若同 code 已存在则创建下一版本 DRAFT，否则版本 1。 */
    @Transactional
    public FormDefResponse create(FormDefRequest req) {
        int nextVersion = repository.findTopByCodeOrderByVersionDesc(req.code())
                .map(f -> f.getVersion() + 1).orElse(1);
        WfFormDef e = new WfFormDef();
        e.setCode(req.code());
        e.setName(req.name());
        e.setVersion(nextVersion);
        e.setSchemaJson(req.schemaJson());
        e.setRemark(req.remark());
        e.setStatus(WfFormDef.STATUS_DRAFT);
        e.setCreatedBy(WfSupport.currentUser().getUserId());
        return FormDefResponse.of(repository.save(e));
    }

    /** 更新：仅 DRAFT 可改。 */
    @Transactional
    public FormDefResponse update(Long id, FormDefRequest req) {
        WfFormDef e = find(id);
        if (!WfFormDef.STATUS_DRAFT.equals(e.getStatus())) {
            throw new BusinessException(400, "已发布的表单不可修改，请创建新版本");
        }
        e.setName(req.name());
        if (StringUtils.hasText(req.schemaJson())) {
            e.setSchemaJson(req.schemaJson());
        }
        e.setRemark(req.remark());
        return FormDefResponse.of(repository.save(e));
    }

    @Transactional
    public FormDefResponse publish(Long id) {
        WfFormDef e = find(id);
        e.setStatus(WfFormDef.STATUS_PUBLISHED);
        return FormDefResponse.of(repository.save(e));
    }

    private WfFormDef find(Long id) {
        return repository.findById(id).orElseThrow(() -> new BusinessException(404, "表单定义不存在"));
    }

    /**
     * 关联表单记录：查以该表单（defCode）为表单编码、已提交的流程实例，作为 relation 控件可选项。
     * 存储 value=procInstId（唯一稳定），展示 label=标题/首个文本字段，summary=表单标量摘要。
     * 若该表单未被任何流程使用（无实例）则返回空页。
     */
    public PageResult<FormRecordResponse> records(String defCode, String keyword, int pageNum, int pageSize) {
        String kw = StringUtils.hasText(keyword) ? keyword : null;
        Page<WfInstanceExt> page = instanceRepository.findFormRecords(defCode, kw,
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize));
        List<FormRecordResponse> list = page.getContent().stream().map(this::toRecord).toList();
        return new PageResult<>(list, page.getTotalElements(), pageNum, pageSize);
    }

    private FormRecordResponse toRecord(WfInstanceExt inst) {
        Map<String, Object> data = parseMap(inst.getFormDataJson());
        String value = StringUtils.hasText(inst.getProcInstId())
                ? inst.getProcInstId() : String.valueOf(inst.getId());
        String label = StringUtils.hasText(inst.getTitle()) ? inst.getTitle() : firstText(data);
        String summary = summarize(data);
        return new FormRecordResponse(inst.getId(), inst.getProcInstId(), inst.getTitle(), label, value, summary);
    }

    /** 首个非空文本型字段值（供无标题时兜底展示）。 */
    private String firstText(Map<String, Object> data) {
        return data.values().stream()
                .filter(v -> v instanceof String s && StringUtils.hasText(s))
                .map(Object::toString)
                .findFirst()
                .orElse("");
    }

    /** 表单数据摘要：取前若干个标量字段拼接（跳过对象/数组），用于识别记录。 */
    private String summarize(Map<String, Object> data) {
        return data.entrySet().stream()
                .filter(e -> e.getValue() != null && !(e.getValue() instanceof Map) && !(e.getValue() instanceof List))
                .limit(3)
                .map(e -> String.valueOf(e.getValue()))
                .filter(StringUtils::hasText)
                .collect(Collectors.joining(" · "));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseMap(String json) {
        if (!StringUtils.hasText(json)) {
            return Map.of();
        }
        try {
            Object o = objectMapper.readValue(json, Object.class);
            return o instanceof Map ? (Map<String, Object>) o : Map.of();
        } catch (Exception e) {
            return Map.of();
        }
    }
}
