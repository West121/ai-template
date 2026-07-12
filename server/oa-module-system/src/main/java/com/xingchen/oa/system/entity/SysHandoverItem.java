package com.xingchen.oa.system.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 交接项（逐项可重试幂等）：item_type=WF_TASK|WF_NODE_ASSIGNEE|DEPT_LEADER|KB_SPACE_OWNER|DATA_OWNER…；
 * status=PENDING|DONE|SKIPPED。ref_type/ref_id 指向被交接对象；old/new_value 为 JSON 留痕；
 * successor_id 覆盖交接单默认继任者（可空）。
 */
@Getter
@Setter
@Entity
@Table(name = "sys_handover_item")
public class SysHandoverItem {

    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_DONE = "DONE";
    public static final String STATUS_SKIPPED = "SKIPPED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "handover_id", nullable = false)
    private Long handoverId;

    @Column(name = "item_type", nullable = false, length = 32)
    private String itemType;

    @Column(name = "ref_type", length = 32)
    private String refType;

    @Column(name = "ref_id", length = 64)
    private String refId;

    @Column(name = "old_value", columnDefinition = "text")
    private String oldValue;

    @Column(name = "new_value", columnDefinition = "text")
    private String newValue;

    @Column(nullable = false, length = 16)
    private String status = STATUS_PENDING;

    /** item 级继任者覆盖（可空 → 用交接单 to_user_id）。 */
    @Column(name = "successor_id")
    private Long successorId;

    @Column(length = 512)
    private String note;
}
