package com.xingchen.oa.office.knowledge.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;

/**
 * 文档-标签关联（ai-knowledge-base.md §2 kb_doc_tag）—— 复合主键 (doc_id, tag_id)。
 */
@Getter
@Setter
@Entity
@Table(name = "kb_doc_tag")
@IdClass(KbDocTag.Pk.class)
public class KbDocTag {

    @Id
    @Column(name = "doc_id")
    private Long docId;

    @Id
    @Column(name = "tag_id")
    private Long tagId;

    public KbDocTag() {
    }

    public KbDocTag(Long docId, Long tagId) {
        this.docId = docId;
        this.tagId = tagId;
    }

    /** 复合主键类：字段名须与实体 @Id 字段一致。 */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Pk implements Serializable {
        private Long docId;
        private Long tagId;
    }
}
