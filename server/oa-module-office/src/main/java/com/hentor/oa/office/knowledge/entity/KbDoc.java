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
 * 文档 / 目录节点（ai-knowledge-base.md §2 kb_doc）—— 树：parent_id 自引用。
 * type：FOLDER 目录 / DOC 文档。version 为业务版本号（保存正文时自增，非 JPA 乐观锁）。
 */
@Getter
@Setter
@Entity
@Table(name = "kb_doc")
public class KbDoc {

    public static final String TYPE_FOLDER = "FOLDER";
    public static final String TYPE_DOC = "DOC";

    public static final String STATUS_DRAFT = "DRAFT";
    public static final String STATUS_PUBLISHED = "PUBLISHED";
    public static final String STATUS_ARCHIVED = "ARCHIVED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "space_id", nullable = false)
    private Long spaceId;

    /** NULL = 空间根节点。 */
    @Column(name = "parent_id")
    private Long parentId;

    @Column(nullable = false, length = 8)
    private String type;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(nullable = false)
    private Integer sort = 0;

    /** AI 摘要，批3 填。 */
    @Column(length = 1000)
    private String summary;

    @Column(nullable = false, length = 16)
    private String status = STATUS_DRAFT;

    @Column(name = "creator_id")
    private Long creatorId;

    @Column(name = "updater_id")
    private Long updaterId;

    @Column(nullable = false)
    private Integer version = 1;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
