package com.hentor.oa.office.knowledge.service;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.office.knowledge.dto.KbDtos.TagRequest;
import com.hentor.oa.office.knowledge.dto.KbDtos.TagResponse;
import com.hentor.oa.office.knowledge.entity.KbTag;
import com.hentor.oa.office.knowledge.repository.KbDocTagRepository;
import com.hentor.oa.office.knowledge.repository.KbTagRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 标签 CRUD（ai-knowledge-base.md §2 kb_tag）。租户内名称唯一；删除同时解绑文档关联。
 */
@Service
@RequiredArgsConstructor
public class KbTagService {

    private static final String TENANT = "default";

    private final KbTagRepository tagRepository;
    private final KbDocTagRepository docTagRepository;

    public List<TagResponse> list() {
        return tagRepository.findByTenantIdOrderByIdAsc(TENANT).stream()
                .map(t -> new TagResponse(t.getId(), t.getName()))
                .toList();
    }

    @Transactional
    public TagResponse create(TagRequest req) {
        if (!StringUtils.hasText(req.name())) {
            throw new BusinessException("标签名不能为空");
        }
        String name = req.name().trim();
        return tagRepository.findByTenantIdAndName(TENANT, name)
                .map(t -> new TagResponse(t.getId(), t.getName()))
                .orElseGet(() -> {
                    KbTag tag = new KbTag();
                    tag.setName(name);
                    KbTag saved = tagRepository.save(tag);
                    return new TagResponse(saved.getId(), saved.getName());
                });
    }

    @Transactional
    public void delete(Long id) {
        KbTag tag = tagRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "标签不存在"));
        docTagRepository.deleteByTagId(id);
        tagRepository.delete(tag);
    }
}
