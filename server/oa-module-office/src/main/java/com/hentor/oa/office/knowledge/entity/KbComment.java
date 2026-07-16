package com.hentor.oa.office.knowledge.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/**
 * 文档评论 / 回复（ai-knowledge-base.md §2 kb_comment，批4a）—— parent_id 自引用建回复树（任意深度）。
 * user 展示名不入表——读时经 KbNameResolver 解析（§2 只存 user_id）。
 * anchor 为选区锚点（批4a 前端文档级评论，先留空）；@提及仅 content 内 “@名字” 文本，本批不结构化。
 */
@Getter
@Setter
@Entity
@Table(name = "kb_comment")
public class KbComment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "doc_id", nullable = false)
    private Long docId;

    /** NULL = 根评论。 */
    @Column(name = "parent_id")
    private Long parentId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    /** 选区锚点，批4a 留空（文档级评论）。 */
    @Column(length = 500)
    private String anchor;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
