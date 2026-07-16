package com.hentor.oa.system.handover;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.CurrentUserHolder;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.system.datadim.DataDimensionService;
import com.hentor.oa.system.entity.SysDept;
import com.hentor.oa.system.entity.SysHandover;
import com.hentor.oa.system.entity.SysHandoverItem;
import com.hentor.oa.system.entity.SysUser;
import com.hentor.oa.system.entity.SysUserAssignment;
import com.hentor.oa.system.handover.HandoverDtos.ExecResult;
import com.hentor.oa.system.handover.HandoverDtos.FailedItem;
import com.hentor.oa.system.handover.HandoverDtos.HandoverView;
import com.hentor.oa.system.handover.HandoverDtos.ItemUpdateRequest;
import com.hentor.oa.system.handover.HandoverDtos.ItemView;
import com.hentor.oa.system.handover.HandoverDtos.ResignRequest;
import com.hentor.oa.system.repository.SysDeptRepository;
import com.hentor.oa.system.repository.SysHandoverItemRepository;
import com.hentor.oa.system.repository.SysHandoverRepository;
import com.hentor.oa.system.repository.SysUserAssignmentRepository;
import com.hentor.oa.system.repository.SysUserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 离职/交接治理编排（DP2）：触发离职 → 扫描各类归属建 item → 逐项幂等执行。
 * <b>不反向依赖业务模块</b>：扫描/执行经 {@link HandoverItemProvider} SPI 分发（WF_TASK 在 workflow、
 * DEPT_LEADER 在 system 各自实现），编排层只认接口。历史数据（applicant_id/办理记录）不动，仅改归属/待办。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class HandoverService {

    private final SysUserRepository userRepository;
    private final SysUserAssignmentRepository assignmentRepository;
    private final SysDeptRepository deptRepository;
    private final SysHandoverRepository handoverRepository;
    private final SysHandoverItemRepository itemRepository;
    private final List<HandoverItemProvider> providers;
    private final DataDimensionService dataDimensionService;
    private final ObjectMapper objectMapper;

    /**
     * 触发离职：校验（部门负责人未指定继任 → 阻断）→ 建 RESIGN 交接单 + 扫描建 items →
     * 置用户 RESIGNED（禁登录 + token 失效）+ 停用其任职（退出组织范围）+ 失效数据权限缓存。返回 handoverId。
     */
    @Transactional
    public Long resign(Long userId, ResignRequest req) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(404, "用户不存在"));
        if (SysUser.STATUS_RESIGNED.equals(user.getStatus())) {
            throw new BusinessException(409, "该用户已离职");
        }
        Long successorId = req == null ? null : req.successorId();
        // 部门负责人阻断：是部门负责人且未指定继任者
        List<SysDept> ledDepts = deptRepository.findByLeaderId(userId);
        if (!ledDepts.isEmpty() && successorId == null) {
            throw new BusinessException(400, "该用户是 " + ledDepts.size() + " 个部门的负责人，请先指定继任者");
        }
        if (successorId != null) {
            if (successorId.equals(userId)) {
                throw new BusinessException(400, "继任者不能是离职人本人");
            }
            SysUser successor = userRepository.findById(successorId)
                    .orElseThrow(() -> new BusinessException(400, "继任者不存在"));
            if (SysUser.STATUS_RESIGNED.equals(successor.getStatus()) || Boolean.FALSE.equals(successor.getEnabled())) {
                throw new BusinessException(400, "继任者须为在职启用用户");
            }
        }

        SysHandover handover = new SysHandover();
        handover.setFromUserId(userId);
        handover.setToUserId(successorId);
        handover.setType(SysHandover.TYPE_RESIGN);
        handover.setReason(req == null ? null : req.reason());
        handover.setStatus(SysHandover.STATUS_DRAFT);
        handover.setOperatorId(currentUserId());
        handoverRepository.save(handover);

        // 扫描各类归属（provider SPI）
        for (HandoverItemProvider provider : providers) {
            for (HandoverScan scan : provider.scan(userId)) {
                SysHandoverItem item = new SysHandoverItem();
                item.setHandoverId(handover.getId());
                item.setItemType(provider.itemType());
                item.setRefType(scan.refType());
                item.setRefId(scan.refId());
                item.setOldValue(scan.oldValue());
                item.setNote(scan.note());
                item.setStatus(SysHandoverItem.STATUS_PENDING);
                itemRepository.save(item);
            }
        }

        // 置离职：禁登录（enabled=false）+ token 失效（status=RESIGNED）+ 停用任职（退出组织范围）
        user.setStatus(SysUser.STATUS_RESIGNED);
        user.setEnabled(false);
        user.setResignDate(req != null && req.resignDate() != null ? req.resignDate() : LocalDate.now());
        userRepository.save(user);
        List<SysUserAssignment> assignments = assignmentRepository.findByUserId(userId);
        assignments.forEach(a -> a.setEnabled(false));
        assignmentRepository.saveAll(assignments);
        dataDimensionService.evictUser(userId); // 数据权限即时失效

        return handover.getId();
    }

    @Transactional(readOnly = true)
    public HandoverView get(Long handoverId) {
        SysHandover h = requireHandover(handoverId);
        List<ItemView> items = itemRepository.findByHandoverIdOrderByIdAsc(handoverId).stream()
                .map(i -> new ItemView(i.getId(), i.getItemType(), i.getRefType(), i.getRefId(),
                        i.getOldValue(), i.getNewValue(), i.getStatus(), i.getSuccessorId(), i.getNote()))
                .toList();
        return new HandoverView(h.getId(), h.getFromUserId(), userName(h.getFromUserId()),
                h.getToUserId(), userName(h.getToUserId()), h.getType(), h.getReason(), h.getStatus(),
                h.getCreatedAt(), h.getCompletedAt(), items);
    }

    /** 逐项调整：改继任者 / 跳过（SKIPPED）。仅未完成项可调。 */
    @Transactional
    public void updateItem(Long handoverId, Long itemId, ItemUpdateRequest req) {
        SysHandoverItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new BusinessException(404, "交接项不存在"));
        if (!item.getHandoverId().equals(handoverId)) {
            throw new BusinessException(400, "交接项不属于该交接单");
        }
        if (SysHandoverItem.STATUS_DONE.equals(item.getStatus())) {
            throw new BusinessException(409, "该项已完成，不可修改");
        }
        if (req != null && req.successorId() != null) {
            item.setSuccessorId(req.successorId());
        }
        if (req != null && SysHandoverItem.STATUS_SKIPPED.equals(req.status())) {
            item.setStatus(SysHandoverItem.STATUS_SKIPPED);
        } else if (req != null && SysHandoverItem.STATUS_PENDING.equals(req.status())) {
            item.setStatus(SysHandoverItem.STATUS_PENDING); // 撤销跳过
        }
        itemRepository.save(item);
    }

    /**
     * 批量执行：逐项调 provider 幂等执行；失败项保持 PENDING 计入 failed 供重试；全部非 PENDING → 交接单 DONE。
     */
    @Transactional
    public ExecResult execute(Long handoverId) {
        SysHandover h = requireHandover(handoverId);
        h.setStatus(SysHandover.STATUS_RUNNING);
        handoverRepository.save(h);

        List<SysHandoverItem> items = itemRepository.findByHandoverIdOrderByIdAsc(handoverId);
        List<Long> done = new ArrayList<>();
        List<FailedItem> failed = new ArrayList<>();
        for (SysHandoverItem item : items) {
            if (!SysHandoverItem.STATUS_PENDING.equals(item.getStatus())) {
                continue; // 幂等：DONE/SKIPPED 不重复执行
            }
            Long successorId = item.getSuccessorId() != null ? item.getSuccessorId() : h.getToUserId();
            HandoverItemProvider provider = providerOf(item.getItemType());
            if (provider == null) {
                item.setNote("无处理器: " + item.getItemType());
                itemRepository.save(item);
                failed.add(new FailedItem(item.getId(), "无处理器: " + item.getItemType()));
                continue;
            }
            try {
                provider.execute(item, successorId);
                item.setStatus(SysHandoverItem.STATUS_DONE);
                item.setNewValue(toJson(Map.of("successorId", successorId == null ? "" : successorId)));
                item.setNote(null);
                itemRepository.save(item);
                done.add(item.getId());
            } catch (Exception e) {
                item.setNote(e.getMessage());
                itemRepository.save(item);
                failed.add(new FailedItem(item.getId(), e.getMessage()));
            }
        }
        boolean allSettled = items.stream().noneMatch(i -> SysHandoverItem.STATUS_PENDING.equals(i.getStatus()));
        if (allSettled) {
            h.setStatus(SysHandover.STATUS_DONE);
            h.setCompletedAt(LocalDateTime.now());
        }
        handoverRepository.save(h);
        return new ExecResult(done, failed);
    }

    private SysHandover requireHandover(Long id) {
        return handoverRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "交接单不存在"));
    }

    private HandoverItemProvider providerOf(String itemType) {
        return providers.stream().filter(p -> p.itemType().equals(itemType)).findFirst().orElse(null);
    }

    private Long currentUserId() {
        UserContext ctx = CurrentUserHolder.get();
        return ctx == null ? null : ctx.getUserId();
    }

    private String userName(Long userId) {
        if (userId == null) {
            return null;
        }
        return userRepository.findById(userId).map(SysUser::getName).orElse(null);
    }

    private String toJson(Object v) {
        try {
            return objectMapper.writeValueAsString(v);
        } catch (Exception e) {
            return String.valueOf(v);
        }
    }
}
