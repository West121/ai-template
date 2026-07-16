package com.hentor.oa.infra.dto;

import com.hentor.oa.infra.entity.SysDictItem;
import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 契约 DictItem = {id,typeId,parentId,label,value,sort,enabled,remark,children[]}
 */
@Data
@AllArgsConstructor
public class DictItemNode {

    private Long id;
    private Long typeId;
    private Long parentId;
    private String label;
    private String value;
    private Integer sort;
    private Boolean enabled;
    private String remark;
    private List<DictItemNode> children;

    public static DictItemNode of(SysDictItem item) {
        return new DictItemNode(item.getId(), item.getTypeId(), item.getParentId(), item.getLabel(),
                item.getValue(), item.getSort(), item.getEnabled(), item.getRemark(), new ArrayList<>());
    }
}
