package com.hentor.oa.office.knowledge.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.OffsetDateTime;

/**
 * 文档正文（ai-knowledge-base.md §2 kb_doc_content）—— 与 {@link KbDoc} 1:1（PK = doc_id）。
 * content_json 为 TipTap JSON（后端只存不解析，当 text 存）；content_text 纯文本（批2 检索用，前端保存时附带）；
 * ydoc 为 Yjs 二进制状态（CRDT 批4 用，本批留空）。
 */
@Getter
@Setter
@Entity
@Table(name = "kb_doc_content")
public class KbDocContent {

    @Id
    @Column(name = "doc_id")
    private Long docId;

    @Column(name = "content_json", columnDefinition = "text")
    private String contentJson;

    @Column(name = "content_text", columnDefinition = "text")
    private String contentText;

    /** Yjs 二进制文档状态，CRDT 批4 用，本批不写。 */
    @Column(columnDefinition = "bytea")
    private byte[] ydoc;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
