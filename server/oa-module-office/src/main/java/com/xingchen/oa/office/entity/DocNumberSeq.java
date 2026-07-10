package com.xingchen.oa.office.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.Setter;

/**
 * 序号池：(rule_id, period) 唯一。占号走 DocNumberService 的原子 UPSERT（ON CONFLICT 自增）防跳；
 * version 列保留供 JPA 乐观锁读改（预览等只读路径）。
 */
@Getter
@Setter
@Entity
@Table(name = "oa_doc_number_seq")
public class DocNumberSeq {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "rule_id", nullable = false)
    private Long ruleId;

    @Column(nullable = false, length = 16)
    private String period;

    @Column(name = "current_seq", nullable = false)
    private Integer currentSeq;

    @Version
    @Column(nullable = false)
    private Long version;
}
