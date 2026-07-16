package com.hentor.oa.office.knowledge.service;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.office.knowledge.dto.KbDtos.DocCreateRequest;
import com.hentor.oa.office.knowledge.dto.KbDtos.DocDetail;
import com.hentor.oa.office.knowledge.dto.KbDtos.DocTagRequest;
import com.hentor.oa.office.knowledge.dto.KbDtos.DocTreeNode;
import com.hentor.oa.office.knowledge.dto.KbDtos.DocUpdateRequest;
import com.hentor.oa.office.knowledge.dto.KbDtos.ContentSaveRequest;
import com.hentor.oa.office.knowledge.dto.KbDtos.TagResponse;
import com.hentor.oa.office.knowledge.dto.KbDtos.VersionContent;
import com.hentor.oa.office.knowledge.dto.KbDtos.VersionResponse;
import com.hentor.oa.office.knowledge.entity.KbDoc;
import com.hentor.oa.office.knowledge.entity.KbDocContent;
import com.hentor.oa.office.knowledge.entity.KbDocTag;
import com.hentor.oa.office.knowledge.entity.KbDocVersion;
import com.hentor.oa.office.knowledge.entity.KbSpace;
import com.hentor.oa.office.knowledge.entity.KbTag;
import com.hentor.oa.office.knowledge.repository.KbCommentRepository;
import com.hentor.oa.office.knowledge.repository.KbDocContentRepository;
import com.hentor.oa.office.knowledge.repository.KbDocRepository;
import com.hentor.oa.office.knowledge.repository.KbDocTagRepository;
import com.hentor.oa.office.knowledge.repository.KbDocVersionRepository;
import com.hentor.oa.office.knowledge.repository.KbSpaceRepository;
import com.hentor.oa.office.knowledge.repository.KbTagRepository;
import com.hentor.oa.office.knowledge.port.KbDocAiPort;
import com.hentor.oa.office.knowledge.support.KbAccess;
import com.hentor.oa.office.knowledge.support.KbNameResolver;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.time.OffsetDateTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
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
    private final KbDocVersionRepository versionRepository;
    private final KbCommentRepository commentRepository;
    private final KbDocTagRepository docTagRepository;
    private final KbTagRepository tagRepository;
    private final KbSpaceRepository spaceRepository;
    private final KbSpaceService spaceService;
    private final KbAccess access;
    private final KbNameResolver nameResolver;
    private final KbEmbeddingService embeddingService;
    private final ObjectMapper objectMapper;
    /**
     * AI 自动处理端口（批3，boot 侧实现，可空）。ObjectProvider 惰性解析——打破装配环：
     * 实现方 {@code KbDocAiAdapter} 反向注入本 Service 写回摘要/标签。切片测试/无实现时静默跳过。
     */
    private final ObjectProvider<KbDocAiPort> aiPortProvider;

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
        versionRepository.deleteByDocIdIn(ids);  // 批4a：级联删版本快照
        commentRepository.deleteByDocIdIn(ids);  // 批4a：级联删评论
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
        // 批4a：每次保存存一版快照（version = 自增后的 kb_doc.version，最新版即当前正文）。
        recordVersion(doc, content.getContentJson(), content.getContentText(), null);
        // 批2：正文提交后重建分块向量（§3/§7）。放事务提交后执行——嵌入是增强不阻断保存，
        // 且提交后读到的正是本次正文；无嵌入凭据时 reindex 仅写 chunk_text（全文降级），毫秒级同步完成。
        // 批3：同一 afterCommit 再触发 AI 自动处理（摘要 + 自动标签，boot 侧异步，失败不阻断）。
        triggerAfterSave(id, doc.getTitle(), req.contentText());
        return detail(id);
    }

    /** content_text 已在 req 中，直接透传；事务提交后重建分块 + AI 自动处理（无 tx 同步则直接调）。 */
    private void triggerAfterSave(Long docId, String title, String contentText) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    afterSave(docId, title, contentText);
                }
            });
        } else {
            afterSave(docId, title, contentText);
        }
    }

    private void afterSave(Long docId, String title, String contentText) {
        embeddingService.reindex(docId, contentText);
        // 批3：AI 自动处理（摘要/标签）。实现方须自身异步 + 兜底，此处不 try/catch 也不阻断
        // （onContentSaved 约定不外抛）；无实现（切片测试/未装配）→ ifAvailable 跳过。
        aiPortProvider.ifAvailable(port -> port.onContentSaved(docId, title, contentText));
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

    // ---------- 批4a：版本历史 + 回滚 ----------

    /** 某文档版本列表（version 降序）。须对空间可见。 */
    public List<VersionResponse> listVersions(Long docId) {
        KbDoc doc = docRepository.findById(docId)
                .orElseThrow(() -> new BusinessException(404, "文档不存在"));
        KbSpace space = spaceRepository.findById(doc.getSpaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireView(space);
        return versionRepository.findByDocIdOrderByVersionDesc(docId).stream()
                .map(v -> new VersionResponse(
                        v.getId(), v.getDocId(), v.getVersion(),
                        v.getEditorId(), nameResolver.userName(v.getEditorId()),
                        v.getNote(), v.getCreatedAt()))
                .toList();
    }

    /** 某版本正文（contentJson + contentText）。须对空间可见；版本不存在 → 404。 */
    public VersionContent versionContent(Long docId, Integer version) {
        KbDoc doc = docRepository.findById(docId)
                .orElseThrow(() -> new BusinessException(404, "文档不存在"));
        KbSpace space = spaceRepository.findById(doc.getSpaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireView(space);
        KbDocVersion v = versionRepository.findByDocIdAndVersion(docId, version)
                .orElseThrow(() -> new BusinessException(404, "版本不存在"));
        return new VersionContent(v.getVersion(), parseJson(v.getContentJson()), v.getContentText());
    }

    /**
     * 回滚到指定版本：以该版正文另存为<b>新版本</b>（version 继续自增，历史不销毁）。
     * 须空间 EDITOR/ADMIN；目标版本不存在 → 404。返回回滚后的文档详情。
     */
    @Transactional
    public DocDetail rollback(Long docId, Integer version) {
        KbDoc doc = docRepository.findById(docId)
                .orElseThrow(() -> new BusinessException(404, "文档不存在"));
        if (!KbDoc.TYPE_DOC.equals(doc.getType())) {
            throw new BusinessException("目录节点没有正文");
        }
        KbSpace space = spaceRepository.findById(doc.getSpaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireEdit(space);
        KbDocVersion target = versionRepository.findByDocIdAndVersion(docId, version)
                .orElseThrow(() -> new BusinessException(404, "版本不存在"));
        KbDocContent content = contentRepository.findById(docId).orElseGet(() -> {
            KbDocContent c = new KbDocContent();
            c.setDocId(docId);
            return c;
        });
        content.setContentJson(target.getContentJson());
        content.setContentText(target.getContentText());
        content.setUpdatedAt(OffsetDateTime.now());
        contentRepository.save(content);
        doc.setVersion(doc.getVersion() + 1);
        doc.setUpdaterId(access.currentUser().getUserId());
        doc.setUpdatedAt(OffsetDateTime.now());
        docRepository.save(doc);
        recordVersion(doc, target.getContentJson(), target.getContentText(), "回滚自 v" + version);
        // 与保存正文一致：提交后重建分块向量 + AI 自动处理，让检索/摘要跟上回滚后的正文
        triggerAfterSave(docId, doc.getTitle(), target.getContentText());
        return detail(docId);
    }

    /** 存一版快照：version = 当前 kb_doc.version（已自增），editor = 当前用户。 */
    private void recordVersion(KbDoc doc, String contentJson, String contentText, String note) {
        KbDocVersion v = new KbDocVersion();
        v.setDocId(doc.getId());
        v.setVersion(doc.getVersion());
        v.setContentJson(contentJson);
        v.setContentText(contentText);
        v.setEditorId(access.currentUser().getUserId());
        v.setNote(note);
        versionRepository.save(v);
    }

    // ---------- 批3：AI 写作辅助 / 自动处理 / 对话固化 ----------

    /**
     * 校验当前用户对该文档所在空间可编辑（EDITOR/ADMIN）；不可编辑 → 403。
     * AI 写作辅助（POST /api/kb/ai/assist）在 docId 提供时的越权红线闸口。
     */
    public void assertDocEditable(Long docId) {
        KbDoc doc = docRepository.findById(docId)
                .orElseThrow(() -> new BusinessException(404, "文档不存在"));
        KbSpace space = spaceRepository.findById(doc.getSpaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireEdit(space);
    }

    /**
     * 校验当前用户对空间可编辑（EDITOR/ADMIN），返回空间名；否则 403。
     * 对话固化 knowledge_save 的预检（红线：非成员空间不能固化入库）。
     */
    public String assertSpaceEditable(Long spaceId) {
        KbSpace space = spaceRepository.findById(spaceId)
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireEdit(space);
        return space.getName();
    }

    /**
     * 批3 · AI 自动处理写回（内部，供 boot 侧适配器在异步链路调用）：
     * 写 summary（截断 1000）+ 自动标签（find-or-create + 去重打标）。<b>无功能/空间权限校验</b>——
     * 系统级增强，权限已在保存正文时校验；文档已删则静默 no-op。摘要/标签任一为空则跳过对应部分。
     */
    @Transactional
    public void applyAiSummaryAndTags(Long docId, String summary, List<String> tagNames) {
        KbDoc doc = docRepository.findById(docId).orElse(null);
        if (doc == null) {
            return; // 文档已删（如保存后随空间级联删）→ 放弃写回
        }
        if (StringUtils.hasText(summary)) {
            String s = summary.trim();
            doc.setSummary(s.length() > 1000 ? s.substring(0, 1000) : s);
            doc.setUpdatedAt(OffsetDateTime.now());
            docRepository.save(doc);
        }
        if (tagNames != null) {
            int applied = 0;
            for (String raw : tagNames) {
                if (!StringUtils.hasText(raw) || applied >= 8) {
                    continue;
                }
                String name = raw.trim();
                if (name.length() > 64) {
                    name = name.substring(0, 64);
                }
                final String tagName = name;
                KbTag tag = tagRepository.findByTenantIdAndName("default", tagName)
                        .orElseGet(() -> {
                            KbTag t = new KbTag();
                            t.setName(tagName);
                            return tagRepository.save(t);
                        });
                if (!docTagRepository.existsByDocIdAndTagId(docId, tag.getId())) {
                    docTagRepository.save(new KbDocTag(docId, tag.getId()));
                }
                applied++;
            }
        }
    }

    /**
     * 批3 · 对话固化：在指定空间新建<b>草稿</b>文档（DRAFT，红线不直接发布）+ 正文（纯文本转 TipTap 段落）。
     * 校验空间可编辑（EDITOR/ADMIN）；由 knowledge_save 动作草稿确认执行器调用（确认者为当前用户）。
     * 返回 {@code {docId, spaceId, title, status, designerPath}}。
     */
    @Transactional
    public Map<String, Object> createAiDraft(Long spaceId, String title, String plainText) {
        KbSpace space = spaceRepository.findById(spaceId)
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireEdit(space);
        Long userId = access.currentUser().getUserId();
        KbDoc doc = new KbDoc();
        doc.setSpaceId(spaceId);
        doc.setParentId(null);
        doc.setType(KbDoc.TYPE_DOC);
        doc.setTitle(StringUtils.hasText(title) ? title.trim() : "未命名草稿");
        doc.setSort(0);
        doc.setStatus(KbDoc.STATUS_DRAFT); // 红线：固化只落草稿，人工二次确认后再发布
        doc.setCreatorId(userId);
        doc.setUpdaterId(userId);
        doc.setVersion(1);
        KbDoc saved = docRepository.save(doc);
        String text = plainText == null ? "" : plainText;
        KbDocContent content = new KbDocContent();
        content.setDocId(saved.getId());
        content.setContentJson(buildTipTapJson(text));
        content.setContentText(text);
        content.setUpdatedAt(OffsetDateTime.now());
        contentRepository.save(content);
        // 批4a：草稿初版也存一版快照（v1），保证版本历史与当前正文一致
        recordVersion(saved, content.getContentJson(), content.getContentText(), "对话固化初稿");
        // 分块索引（可搜）+ AI 自动处理（草稿也生成摘要/标签），走 afterCommit 兜底
        triggerAfterSave(saved.getId(), saved.getTitle(), text);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("docId", saved.getId());
        out.put("spaceId", spaceId);
        out.put("title", saved.getTitle());
        out.put("status", saved.getStatus());
        out.put("designerPath", "/knowledge/" + spaceId + "?doc=" + saved.getId());
        return out;
    }

    /** 纯文本 → 最小 TipTap doc JSON（按换行拆段落，空行 → 空段落）。后端只存不渲染。 */
    private String buildTipTapJson(String plainText) {
        ObjectNode docNode = objectMapper.createObjectNode();
        docNode.put("type", "doc");
        ArrayNode paras = docNode.putArray("content");
        String[] lines = plainText.isEmpty() ? new String[] {""} : plainText.split("\n", -1);
        for (String line : lines) {
            ObjectNode para = paras.addObject();
            para.put("type", "paragraph");
            if (StringUtils.hasText(line)) {
                ObjectNode textNode = para.putArray("content").addObject();
                textNode.put("type", "text");
                textNode.put("text", line);
            }
        }
        return docNode.toString();
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
