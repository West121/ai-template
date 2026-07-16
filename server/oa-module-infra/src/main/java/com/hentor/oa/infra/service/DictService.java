package com.hentor.oa.infra.service;

import com.hentor.oa.common.core.BatchResult;
import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.infra.dto.DictItemNode;
import com.hentor.oa.infra.dto.DictItemRequest;
import com.hentor.oa.infra.dto.DictTypeRequest;
import com.hentor.oa.infra.dto.DictTypeResponse;
import com.hentor.oa.infra.entity.SysDictItem;
import com.hentor.oa.infra.entity.SysDictType;
import com.hentor.oa.infra.repository.SysDictItemRepository;
import com.hentor.oa.infra.repository.SysDictTypeRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 字典管理：类型 CRUD + 树形字典项（parent_id = 0 为根）。
 */
@Service
@RequiredArgsConstructor
public class DictService {

    private final SysDictTypeRepository typeRepository;
    private final SysDictItemRepository itemRepository;

    // ------------------------------------------------------------------
    // 字典类型
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public PageResult<DictTypeResponse> pageTypes(String keyword, int pageNum, int pageSize) {
        Pageable pageable = PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Order.asc("id")));
        Page<SysDictType> page = StringUtils.hasText(keyword)
                ? typeRepository.findByNameContainingOrCodeContaining(keyword, keyword, pageable)
                : typeRepository.findAll(pageable);
        return PageResult.from(page.map(t -> DictTypeResponse.of(t, itemRepository.countByTypeId(t.getId()))));
    }

    @Transactional
    public DictTypeResponse createType(DictTypeRequest request) {
        if (typeRepository.existsByCode(request.code())) {
            throw new BusinessException(400, "字典编码已存在");
        }
        SysDictType type = new SysDictType();
        apply(type, request);
        typeRepository.save(type);
        return DictTypeResponse.of(type, 0);
    }

    @Transactional
    public DictTypeResponse updateType(Long id, DictTypeRequest request) {
        SysDictType type = typeRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "字典类型不存在"));
        if (typeRepository.existsByCodeAndIdNot(request.code(), id)) {
            throw new BusinessException(400, "字典编码已存在");
        }
        apply(type, request);
        typeRepository.save(type);
        return DictTypeResponse.of(type, itemRepository.countByTypeId(id));
    }

    @Transactional
    public void deleteType(Long id) {
        SysDictType type = typeRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "字典类型不存在"));
        if (itemRepository.countByTypeId(id) > 0) {
            throw new BusinessException(400, "该字典类型下存在字典项，无法删除");
        }
        typeRepository.delete(type);
    }

    /**
     * 批量删除字典类型（统一协议）。护栏：类型下存在字典项不可删（计 failed）。幂等：已不存在计 success。
     */
    @Transactional
    public BatchResult batchDeleteTypes(List<Long> ids) {
        BatchResult result = new BatchResult();
        for (Long id : distinctIds(ids)) {
            var typeOpt = typeRepository.findById(id);
            if (typeOpt.isEmpty()) {
                result.success(id);
                continue;
            }
            if (itemRepository.countByTypeId(id) > 0) {
                result.fail(id, "该字典类型下存在字典项，无法删除");
                continue;
            }
            typeRepository.delete(typeOpt.get());
            result.success(id);
        }
        return result;
    }

    private void apply(SysDictType type, DictTypeRequest request) {
        type.setCode(request.code());
        type.setName(request.name());
        type.setRemark(request.remark());
        type.setEnabled(request.enabled() != null ? request.enabled() : Boolean.TRUE);
    }

    // ------------------------------------------------------------------
    // 字典项（树形）
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<DictItemNode> itemTree(Long typeId) {
        typeRepository.findById(typeId)
                .orElseThrow(() -> new BusinessException(404, "字典类型不存在"));
        return buildTree(itemRepository.findByTypeIdOrderBySortAscIdAsc(typeId));
    }

    @Transactional
    public DictItemNode createItem(DictItemRequest request) {
        typeRepository.findById(request.typeId())
                .orElseThrow(() -> new BusinessException(404, "字典类型不存在"));
        long parentId = request.parentId() != null ? request.parentId() : 0L;
        if (parentId != 0) {
            SysDictItem parent = itemRepository.findById(parentId)
                    .orElseThrow(() -> new BusinessException(400, "父级字典项不存在"));
            if (!parent.getTypeId().equals(request.typeId())) {
                throw new BusinessException(400, "父级字典项与当前类型不一致");
            }
        }
        SysDictItem item = new SysDictItem();
        item.setTypeId(request.typeId());
        item.setParentId(parentId);
        applyItem(item, request);
        itemRepository.save(item);
        return DictItemNode.of(item);
    }

    @Transactional
    public DictItemNode updateItem(Long id, DictItemRequest request) {
        SysDictItem item = itemRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "字典项不存在"));
        if (request.parentId() != null && !request.parentId().equals(item.getParentId())) {
            if (request.parentId().equals(id)) {
                throw new BusinessException(400, "父级不能为自身");
            }
            if (request.parentId() != 0 && itemRepository.findById(request.parentId()).isEmpty()) {
                throw new BusinessException(400, "父级字典项不存在");
            }
            item.setParentId(request.parentId());
        }
        applyItem(item, request);
        itemRepository.save(item);
        return DictItemNode.of(item);
    }

    @Transactional
    public void deleteItem(Long id) {
        SysDictItem item = itemRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "字典项不存在"));
        if (itemRepository.countByParentId(id) > 0) {
            throw new BusinessException(400, "该字典项下存在子项，无法删除");
        }
        itemRepository.delete(item);
    }

    /**
     * 批量删除字典项（统一协议）。护栏：字典项下存在子项不可删（计 failed）。幂等：已不存在计 success。
     */
    @Transactional
    public BatchResult batchDeleteItems(List<Long> ids) {
        BatchResult result = new BatchResult();
        for (Long id : distinctIds(ids)) {
            var itemOpt = itemRepository.findById(id);
            if (itemOpt.isEmpty()) {
                result.success(id);
                continue;
            }
            if (itemRepository.countByParentId(id) > 0) {
                result.fail(id, "该字典项下存在子项，无法删除");
                continue;
            }
            itemRepository.delete(itemOpt.get());
            result.success(id);
        }
        return result;
    }

    private static List<Long> distinctIds(List<Long> ids) {
        if (ids == null) {
            return List.of();
        }
        return ids.stream().filter(java.util.Objects::nonNull).distinct().toList();
    }

    private void applyItem(SysDictItem item, DictItemRequest request) {
        item.setLabel(request.label());
        item.setValue(request.value());
        item.setSort(request.sort() != null ? request.sort() : 0);
        item.setEnabled(request.enabled() != null ? request.enabled() : Boolean.TRUE);
        item.setRemark(request.remark());
    }

    /**
     * 业务侧取字典：按 code 返回 enabled 项的树（禁用节点连同子树剔除）。
     */
    @Transactional(readOnly = true)
    public List<DictItemNode> optionsByCode(String code) {
        SysDictType type = typeRepository.findByCode(code)
                .orElseThrow(() -> new BusinessException(404, "字典类型不存在: " + code));
        if (Boolean.FALSE.equals(type.getEnabled())) {
            return List.of();
        }
        List<SysDictItem> items = itemRepository.findByTypeIdOrderBySortAscIdAsc(type.getId()).stream()
                .filter(i -> Boolean.TRUE.equals(i.getEnabled()))
                .toList();
        return buildTree(items, true);
    }

    private List<DictItemNode> buildTree(List<SysDictItem> items) {
        return buildTree(items, false);
    }

    /**
     * @param dropOrphan true 时父节点缺失（被禁用/删除）的子树整体剔除；false 时提升为根节点展示
     */
    private List<DictItemNode> buildTree(List<SysDictItem> items, boolean dropOrphan) {
        Map<Long, DictItemNode> nodeMap = new LinkedHashMap<>();
        items.forEach(i -> nodeMap.put(i.getId(), DictItemNode.of(i)));
        List<DictItemNode> roots = new ArrayList<>();
        for (DictItemNode node : nodeMap.values()) {
            if (node.getParentId() == null || node.getParentId() == 0) {
                roots.add(node);
            } else {
                DictItemNode parent = nodeMap.get(node.getParentId());
                if (parent != null) {
                    parent.getChildren().add(node);
                } else if (!dropOrphan) {
                    roots.add(node);
                }
            }
        }
        return roots;
    }
}
