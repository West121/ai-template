package com.xingchen.oa.office.knowledge.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.office.knowledge.dto.KbDtos.DocCreateRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.DocDetail;
import com.xingchen.oa.office.knowledge.dto.KbDtos.DocTagRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.DocTreeNode;
import com.xingchen.oa.office.knowledge.dto.KbDtos.DocUpdateRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.ContentSaveRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.TagResponse;
import com.xingchen.oa.office.knowledge.entity.KbDoc;
import com.xingchen.oa.office.knowledge.entity.KbDocContent;
import com.xingchen.oa.office.knowledge.entity.KbDocTag;
import com.xingchen.oa.office.knowledge.entity.KbSpace;
import com.xingchen.oa.office.knowledge.entity.KbTag;
import com.xingchen.oa.office.knowledge.repository.KbDocContentRepository;
import com.xingchen.oa.office.knowledge.repository.KbDocRepository;
import com.xingchen.oa.office.knowledge.repository.KbDocTagRepository;
import com.xingchen.oa.office.knowledge.repository.KbSpaceRepository;
import com.xingchen.oa.office.knowledge.repository.KbTagRepository;
import com.xingchen.oa.office.knowledge.support.KbAccess;
import com.xingchen.oa.office.knowledge.support.KbNameResolver;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 知识库目录树 + 文档 CRUD（ai-knowledge-base.md §2/§7 批1）。
 * 正文层只存不渲染：content_json（TipTap JSON）当 text 存，后端不解析；content_text 由前端抽取附带。
 */
@Service
@RequiredArgsConstructor
public class KbDocService {

    private final KbDocRepository docRepository;
    private final KbDocContentRepository contentRepository;
    private final KbDocTagRepository docTagRepository;
    private final KbTagRepository tagRepository;
    private final KbSpaceRepository spaceRepository;
    private final KbSpaceService spaceService;
    private final KbAccess access;
    private final KbNameResolver nameResolver;
    private final KbEmbeddingService embeddingService;
    private final ObjectMapper objectMapper;

    /** 空间下目录树（FOLDER/DOC）。须对空间可见。 */
    public List<DocTreeNode> tree(Long spaceId) {
        spaceService.requireVisibleSpace(spaceId);
        List<KbDoc> docs = docRepository.findBySpaceIdOrderBySortAscIdAsc(spaceId);
        Map<Long, List<KbDoc>> byParent = new HashMap<>();
        for (KbDoc d : docs) {
            byParent.computeIfAbsent(d.getParentId(), k -> new ArrayList<>()).add(d);
        }
        return buildChildren(null, byParent);
    }

    private List<DocTreeNode> buildChildren(Long parentId, Map<Long, List<KbDoc>> byParent) {
        List<KbDoc> children = byParent.getOrDefault(parentId, List.of());
        List<DocTreeNode> out = new ArrayList<>(children.size());
        for (KbDoc d : children) {
            out.add(new DocTreeNode(
                    d.getId(), d.getSpaceId(), d.getParentId(), d.getType(), d.getTitle(), d.getSort(),
                    d.getStatus(), d.getSummary(), d.getVersion(), d.getUpdatedAt(),
                    buildChildren(d.getId(), byParent)));
        }
        return out;
    }

    @Transactional
    public DocDetail create(DocCreateRequest req) {
        if (req.spaceId() == null) {
            throw new BusinessException("spaceId 不能为空");
        }
        KbSpace space = spaceRepository.findById(req.spaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireEdit(space);
        String type = req.type();
        if (!KbDoc.TYPE_FOLDER.equals(type) && !KbDoc.TYPE_DOC.equals(type)) {
            throw new BusinessException("非法的节点类型：" + type);
        }
        if (req.parentId() != null) {
            KbDoc parent = loadDocInSpace(req.parentId(), space.getId());
            if (!KbDoc.TYPE_FOLDER.equals(parent.getType())) {
                throw new BusinessException("父节点必须是目录（FOLDER）");
            }
        }
        Long userId = access.currentUser().getUserId();
        KbDoc doc = new KbDoc();
        doc.setSpaceId(space.getId());
        doc.setParentId(req.parentId());
        doc.setType(type);
        doc.setTitle(req.title());
        doc.setSort(req.sort() != null ? req.sort() : 0);
        doc.setStatus(KbDoc.STATUS_DRAFT);
        doc.setCreatorId(userId);
        doc.setUpdaterId(userId);
        doc.setVersion(1);
        KbDoc saved = docRepository.save(doc);
        if (KbDoc.TYPE_DOC.equals(type)) {
            KbDocContent content = new KbDocContent();
            content.setDocId(saved.getId());
            content.setUpdatedAt(OffsetDateTime.now());
            contentRepository.save(content);
        }
        return detail(saved.getId());
    }

    /** 改标题 / 移动(parentId：0 表示移到根) / 排序。字段为 null 表示不改。 */
    @Transactional
    public DocDetail update(Long id, DocUpdateRequest req) {
        KbDoc doc = docRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文档不存在"));
        KbSpace space = spaceRepository.findById(doc.getSpaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireEdit(space);
        if (StringUtils.hasText(req.title())) {
            doc.setTitle(req.title());
        }
        if (req.parentId() != null) {
            Long newParent = req.parentId() == 0 ? null : req.parentId();
            applyMove(doc, newParent);
        }
        if (req.sort() != null) {
            doc.setSort(req.sort());
        }
        doc.setUpdaterId(access.currentUser().getUserId());
        doc.setUpdatedAt(OffsetDateTime.now());
        docRepository.save(doc);
        return detail(id);
    }

    private void applyMove(KbDoc doc, Long newParentId) {
        if (newParentId == null) {
            doc.setParentId(null);
            return;
        }
        if (newParentId.equals(doc.getId())) {
            throw new BusinessException("不能移动到自身");
        }
        KbDoc parent = loadDocInSpace(newParentId, doc.getSpaceId());
        if (!KbDoc.TYPE_FOLDER.equals(parent.getType())) {
            throw new BusinessException("父节点必须是目录（FOLDER）");
        }
        // 防环：新父不能是自身子孙
        Set<Long> descendants = descendantIds(doc);
        if (descendants.contains(newParentId)) {
            throw new BusinessException("不能移动到自身的子目录下");
        }
        doc.setParentId(newParentId);
    }

    /** 删除节点：级联删除整棵子树（含正文/标签关联）。 */
    @Transactional
    public void delete(Long id) {
        KbDoc doc = docRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文档不存在"));
        KbSpace space = spaceRepository.findById(doc.getSpaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireEdit(space);
        Set<Long> ids = descendantIds(doc);
        ids.add(doc.getId());
        docTagRepository.deleteByDocIdIn(ids);
        contentRepository.deleteByDocIdIn(ids);
        embeddingService.deleteByDocIds(ids); // 批2：级联删分块向量
        docRepository.deleteAllByIdInBatch(ids);
    }

    public DocDetail detail(Long id) {
        KbDoc doc = docRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文档不存在"));
        KbSpace space = spaceRepository.findById(doc.getSpaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireView(space);
        KbDocContent content = contentRepository.findById(id).orElse(null);
        JsonNode contentJson = content != null ? parseJson(content.getContentJson()) : null;
        String contentText = content != null ? content.getContentText() : null;
        return new DocDetail(
                doc.getId(), doc.getSpaceId(), doc.getParentId(), doc.getType(), doc.getTitle(), doc.getStatus(),
                doc.getSummary(), doc.getVersion(),
                doc.getCreatorId(), nameResolver.userName(doc.getCreatorId()),
                doc.getUpdaterId(), nameResolver.userName(doc.getUpdaterId()),
                contentJson, contentText, docTags(id),
                doc.getCreatedAt(), doc.getUpdatedAt());
    }

    /** 保存正文：content_json + content_text；文档版本号自增。 */
    @Transactional
    public DocDetail saveContent(Long id, ContentSaveRequest req) {
        KbDoc doc = docRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文档不存在"));
        if (!KbDoc.TYPE_DOC.equals(doc.getType())) {
            throw new BusinessException("目录节点没有正文");
        }
        KbSpace space = spaceRepository.findById(doc.getSpaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireEdit(space);
        KbDocContent content = contentRepository.findById(id).orElseGet(() -> {
            KbDocContent c = new KbDocContent();
            c.setDocId(id);
            return c;
        });
        content.setContentJson(req.contentJson() != null && !req.contentJson().isNull()
                ? req.contentJson().toString() : null);
        content.setContentText(req.contentText());
        content.setUpdatedAt(OffsetDateTime.now());
        contentRepository.save(content);
        doc.setVersion(doc.getVersion() + 1);
        doc.setUpdaterId(access.currentUser().getUserId());
        doc.setUpdatedAt(OffsetDateTime.now());
        docRepository.save(doc);
        // 批2：正文提交后重建分块向量（§3/§7）。放事务提交后执行——嵌入是增强不阻断保存，
        // 且提交后读到的正是本次正文；无嵌入凭据时 reindex 仅写 chunk_text（全文降级），毫秒级同步完成。
        triggerReindex(id, req.contentText());
        return detail(id);
    }

    /** content_text 已在 req 中，直接透传；事务提交后重建（无 tx 同步则直接调）。 */
    private void triggerReindex(Long docId, String contentText) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    embeddingService.reindex(docId, contentText);
                }
            });
        } else {
            embeddingService.reindex(docId, contentText);
        }
    }

    @Transactional
    public DocDetail changeStatus(Long id, String status) {
        KbDoc doc = docRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文档不存在"));
        KbSpace space = spaceRepository.findById(doc.getSpaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireEdit(space);
        doc.setStatus(status);
        doc.setUpdaterId(access.currentUser().getUserId());
        doc.setUpdatedAt(OffsetDateTime.now());
        docRepository.save(doc);
        return detail(id);
    }

    // ---------- 文档标签 ----------

    public List<TagResponse> docTags(Long docId) {
        List<KbDocTag> links = docTagRepository.findByDocId(docId);
        if (links.isEmpty()) {
            return List.of();
        }
        List<Long> tagIds = links.stream().map(KbDocTag::getTagId).toList();
        return tagRepository.findAllById(tagIds).stream()
                .map(t -> new TagResponse(t.getId(), t.getName()))
                .toList();
    }

    @Transactional
    public TagResponse addDocTag(Long docId, DocTagRequest req) {
        KbDoc doc = docRepository.findById(docId)
                .orElseThrow(() -> new BusinessException(404, "文档不存在"));
        KbSpace space = spaceRepository.findById(doc.getSpaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireEdit(space);
        KbTag tag;
        if (req.tagId() != null) {
            tag = tagRepository.findById(req.tagId())
                    .orElseThrow(() -> new BusinessException(404, "标签不存在"));
        } else if (StringUtils.hasText(req.name())) {
            tag = tagRepository.findByTenantIdAndName("default", req.name().trim())
                    .orElseGet(() -> {
                        KbTag t = new KbTag();
                        t.setName(req.name().trim());
                        return tagRepository.save(t);
                    });
        } else {
            throw new BusinessException("需提供 tagId 或 name");
        }
        if (!docTagRepository.existsByDocIdAndTagId(docId, tag.getId())) {
            docTagRepository.save(new KbDocTag(docId, tag.getId()));
        }
        return new TagResponse(tag.getId(), tag.getName());
    }

    @Transactional
    public void removeDocTag(Long docId, Long tagId) {
        KbDoc doc = docRepository.findById(docId)
                .orElseThrow(() -> new BusinessException(404, "文档不存在"));
        KbSpace space = spaceRepository.findById(doc.getSpaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireEdit(space);
        docTagRepository.deleteByDocIdAndTagId(docId, tagId);
    }

    // ---------- 辅助 ----------

    private KbDoc loadDocInSpace(Long id, Long spaceId) {
        KbDoc doc = docRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "节点不存在"));
        if (!doc.getSpaceId().equals(spaceId)) {
            throw new BusinessException("节点不属于该空间");
        }
        return doc;
    }

    /** 计算某节点的全部子孙 id（同空间内 BFS）。 */
    private Set<Long> descendantIds(KbDoc doc) {
        List<KbDoc> all = docRepository.findBySpaceIdOrderBySortAscIdAsc(doc.getSpaceId());
        Map<Long, List<KbDoc>> byParent = new HashMap<>();
        for (KbDoc d : all) {
            byParent.computeIfAbsent(d.getParentId(), k -> new ArrayList<>()).add(d);
        }
        Set<Long> ids = new java.util.HashSet<>();
        Deque<Long> queue = new ArrayDeque<>();
        queue.add(doc.getId());
        while (!queue.isEmpty()) {
            Long cur = queue.poll();
            for (KbDoc child : byParent.getOrDefault(cur, List.of())) {
                if (ids.add(child.getId())) {
                    queue.add(child.getId());
                }
            }
        }
        return ids;
    }

    private JsonNode parseJson(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (RuntimeException e) {
            // 容错：脏数据不抛（防白屏），退回 null
            return null;
        }
    }
}
