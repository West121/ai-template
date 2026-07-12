package com.xingchen.oa.office.knowledge.dto;

import jakarta.validation.constraints.NotBlank;
import tools.jackson.databind.JsonNode;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 知识库域 DTO（聚合 record）—— 契约见 ai-knowledge-base.md §2/§5。
 */
public final class KbDtos {

    private KbDtos() {
    }

    // ---------- 空间 ----------

    /** 创建/更新空间。code 更新时忽略（不可改）。 */
    public record SpaceRequest(
            @NotBlank(message = "空间名称不能为空") String name,
            String code,
            String description,
            String icon,
            String visibility,
            Integer sort) {
    }

    /**
     * 空间响应。myRole = 当前用户在该空间的有效角色（ADMIN/EDITOR/VIEWER）；
     * 非成员访问可见空间（PUBLIC/INTERNAL）时为 null（只读）。
     */
    public record SpaceResponse(
            Long id, String name, String code, String description, String icon,
            String visibility, Long ownerId, String ownerName, Integer sort, String status,
            String myRole, long memberCount, long docCount,
            OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    // ---------- 成员 ----------

    public record MemberRequest(
            @NotBlank(message = "主体类型不能为空") String principalType,
            Long principalId,
            String role) {
    }

    public record MemberResponse(
            Long id, String principalType, Long principalId, String principalName, String role,
            OffsetDateTime createdAt) {
    }

    // ---------- 目录树 / 文档节点 ----------

    /** 创建目录/文档节点。 */
    public record DocCreateRequest(
            Long spaceId,
            Long parentId,
            @NotBlank(message = "节点类型不能为空") String type,
            @NotBlank(message = "标题不能为空") String title,
            Integer sort) {
    }

    /** 改标题 / 移动(parentId) / 排序。字段为 null 表示不改。 */
    public record DocUpdateRequest(
            String title,
            Long parentId,
            Integer sort) {
    }

    /** 目录树节点（children 递归）。 */
    public record DocTreeNode(
            Long id, Long spaceId, Long parentId, String type, String title, Integer sort,
            String status, String summary, Integer version, OffsetDateTime updatedAt,
            List<DocTreeNode> children) {
    }

    /** 文档详情（含正文与标签）。 */
    public record DocDetail(
            Long id, Long spaceId, Long parentId, String type, String title, String status,
            String summary, Integer version,
            Long creatorId, String creatorName, Long updaterId, String updaterName,
            JsonNode contentJson, String contentText, List<TagResponse> tags,
            OffsetDateTime createdAt, OffsetDateTime updatedAt) {
    }

    /** 保存正文：content_json（TipTap JSON，后端不解析）+ content_text（前端抽取的纯文本，批2 检索用）。 */
    public record ContentSaveRequest(
            JsonNode contentJson,
            String contentText) {
    }

    // ---------- 标签 ----------

    public record TagRequest(
            @NotBlank(message = "标签名不能为空") String name) {
    }

    public record TagResponse(Long id, String name) {
    }

    /** 给文档打标签：二选一，tagId 优先；否则按 name 取或建。 */
    public record DocTagRequest(Long tagId, String name) {
    }

    // ---------- 检索 / 相关推荐（批2，ai-knowledge-base.md §3/§7） ----------

    /** 混合检索请求：q 查询词；spaceId 可选（限定单空间，须可见）；分页（缺省 1/10）。 */
    public record SearchRequest(
            @NotBlank(message = "查询词不能为空") String q,
            Long spaceId,
            Integer pageNum,
            Integer pageSize) {
    }

    /**
     * 检索命中。matchedBy：vector 语义 / fulltext 全文 / hybrid 混合。
     * snippet 为含 {@code <mark>} 高亮的片段；score 为混合排序分（降序）。
     */
    public record SearchHit(
            Long docId, String title, Long spaceId, String spaceName,
            String snippet, double score, String matchedBy) {
    }

    /** 相关文档：pgvector 余弦相似 Top-N（无嵌入→全文相似降级）；score 越大越相似。 */
    public record RelatedDoc(
            Long docId, String title, Long spaceId, String spaceName, double score) {
    }
}
