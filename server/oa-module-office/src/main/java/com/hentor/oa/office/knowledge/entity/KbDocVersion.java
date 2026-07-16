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
 * 版本历史（ai-knowledge-base.md §2 kb_doc_version，批4a）—— 与 {@link KbDoc} 一对多。
 * 保存正文（PUT /docs/{id}/content）与回滚时各存一版，{@code version} = 保存/回滚后的 kb_doc.version
 * （同文档内唯一，单调递增，不销毁历史）。content_json 为 TipTap JSON（只存不解析）。
 * editor 展示名不入表——读时经 KbNameResolver 解析（§2 只存 editor_id）。
 */
@Getter
@Setter
@Entity
@Table(name = "kb_doc_version")
public class KbDocVersion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "doc_id", nullable = false)
    private Long docId;

    @Column(nullable = false)
    private Integer version;

    @Column(name = "content_json", columnDefinition = "text")
    private String contentJson;

    @Column(name = "content_text", columnDefinition = "text")
    private String contentText;

    @Column(name = "editor_id")
    private Long editorId;

    /** 回滚版记 “回滚自 vX”；普通保存留空。 */
    @Column(length = 255)
    private String note;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
}
