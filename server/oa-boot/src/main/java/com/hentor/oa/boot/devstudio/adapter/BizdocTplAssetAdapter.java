package com.hentor.oa.boot.devstudio.adapter;

import com.hentor.oa.boot.devstudio.dto.DevStudioDtos.AssetContent;
import com.hentor.oa.boot.devstudio.dto.DevStudioDtos.AssetNode;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.office.dto.bizdoc.BizDocDtos.TplRequest;
import com.hentor.oa.office.entity.BizDocPrintTpl;
import com.hentor.oa.office.repository.BizDocPrintTplRepository;
import com.hentor.oa.office.service.BizDocTplService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * BIZDOC_TPL（打印模板 oa_bizdoc_print_tpl.content = BdTemplateV2 元素树）适配。
 * 保存=BizDocTplService.update（BIZDOC 绑定模板经 defs/{id}/print-tpls 管理，原生 400 拒绝，照透传）；
 * 发布=publish（PUBLISHED + version+1，运行渲染只认 PUBLISHED）。
 */
@Component
@RequiredArgsConstructor
public class BizdocTplAssetAdapter implements DevAssetAdapter {

    private final BizDocPrintTplRepository repository;
    private final BizDocTplService tplService;
    private final ObjectMapper objectMapper;

    @Override
    public String type() {
        return "BIZDOC_TPL";
    }

    @Override
    public String writeAuthority() {
        return "bizdoc:def:write";
    }

    @Override
    public List<AssetNode> list() {
        List<AssetNode> out = new ArrayList<>();
        for (BizDocPrintTpl t : repository.findAll()) {
            out.add(new AssetNode(type(), t.getCode(), t.getName(), t.getStatus(), t.getVersion(),
                    t.getUpdatedAt() != null ? t.getUpdatedAt() : t.getCreatedAt()));
        }
        return out;
    }

    @Override
    public AssetContent read(String code) {
        BizDocPrintTpl t = find(code);
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("id", t.getId());
        meta.put("tplId", t.getId()); // 前端直达 /bizdoc/tpl/t/:tplId 设计器
        meta.put("name", t.getName());
        meta.put("status", t.getStatus());
        meta.put("nativeVersion", t.getVersion());
        meta.put("bindType", t.getBindType());
        meta.put("bindCode", t.getBindCode());
        meta.put("defId", t.getDefId());
        meta.put("paper", t.getPaper());
        meta.put("landscape", t.getLandscape());
        meta.put("category", t.getCategory());
        return new AssetContent(type(), code, t.getContent(), null, meta);
    }

    @Override
    public Map<String, Object> save(String code, String content, boolean publish) {
        BizDocPrintTpl t = find(code);
        JsonNode node = parseObject(content);
        // 仅替换 content；其余字段传 null（BizDocTplService.apply 空值不覆盖）
        tplService.update(t.getId(), new TplRequest(null, null, null, null, null, null, null, null, node));
        if (publish) {
            tplService.publish(t.getId()); // PUBLISHED + version+1
        }
        BizDocPrintTpl after = find(code);
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("tplId", after.getId());
        meta.put("nativeVersion", after.getVersion());
        meta.put("status", after.getStatus());
        meta.put("bindType", after.getBindType());
        return meta;
    }

    @Override
    public void validate(String code, String content) {
        find(code);
        parseObject(content);
    }

    private BizDocPrintTpl find(String code) {
        return repository.findByCode(code)
                .orElseThrow(() -> new BusinessException(404, "打印模板不存在: " + code));
    }

    private JsonNode parseObject(String content) {
        try {
            JsonNode n = objectMapper.readTree(content);
            if (!n.isObject()) {
                throw new BusinessException(400, "模板 content 须为 JSON 对象（BdTemplateV2 元素树）");
            }
            return n;
        } catch (BusinessException be) {
            throw be;
        } catch (Exception e) {
            throw new BusinessException(400, "模板 content 不是合法 JSON: " + e.getMessage());
        }
    }
}
