package com.xingchen.oa.office.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.office.dto.LeaveCreateRequest;
import com.xingchen.oa.office.dto.LeaveQuotaResponse;
import com.xingchen.oa.office.dto.LeaveResponse;
import com.xingchen.oa.office.entity.Leave;
import com.xingchen.oa.office.repository.LeaveQuotaRepository;
import com.xingchen.oa.office.repository.LeaveRepository;
import com.xingchen.oa.office.support.DeptNameResolver;
import com.xingchen.oa.office.support.SecuritySupport;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class LeaveService {

    private final LeaveRepository leaveRepository;
    private final LeaveQuotaRepository quotaRepository;
    private final DeptNameResolver deptNameResolver;

    /**
     * 请假列表【DS】。
     */
    public PageResult<LeaveResponse> page(int pageNum, int pageSize) {
        Page<Leave> page = leaveRepository.findAll(
                SecuritySupport.dataScope("deptId", "userId"),
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "createdAt")));
        Map<Long, String> deptNames = deptNameResolver.nameMap();
        List<LeaveResponse> list = page.getContent().stream()
                .map(l -> toResponse(l, deptNames))
                .toList();
        return new PageResult<>(list, page.getTotalElements(), page.getNumber() + 1, page.getSize());
    }

    /**
     * 我的假期额度。
     */
    public List<LeaveQuotaResponse> quotas() {
        Long userId = SecuritySupport.currentUser().getUserId();
        return quotaRepository.findByUserIdOrderByIdAsc(userId).stream()
                .map(q -> new LeaveQuotaResponse(q.getType(), q.getTotal(), q.getUsed()))
                .toList();
    }

    @Transactional
    public LeaveResponse create(LeaveCreateRequest request) {
        UserContext context = SecuritySupport.currentUser();
        if (request.endDate().isBefore(request.startDate())) {
            throw new BusinessException(400, "结束日期不能早于开始日期");
        }
        Leave leave = new Leave();
        leave.setUserId(context.getUserId());
        leave.setApplicant(SecuritySupport.displayName(context));
        leave.setDeptId(context.getActiveDeptId());
        leave.setType(request.type());
        leave.setStartDate(request.startDate());
        leave.setEndDate(request.endDate());
        leave.setDays(request.days());
        leave.setReason(request.reason());
        leave.setStatus(Leave.STATUS_PENDING);
        return toResponse(leaveRepository.save(leave), deptNameResolver.nameMap());
    }

    /**
     * 撤回：仅本人且 PENDING。
     */
    @Transactional
    public LeaveResponse withdraw(Long id) {
        Long userId = SecuritySupport.currentUser().getUserId();
        Leave leave = leaveRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "请假申请不存在"));
        if (!Objects.equals(leave.getUserId(), userId)) {
            throw new BusinessException(403, "仅申请人本人可撤回");
        }
        if (!Leave.STATUS_PENDING.equals(leave.getStatus())) {
            throw new BusinessException(400, "仅待审批的申请可撤回");
        }
        leave.setStatus(Leave.STATUS_WITHDRAWN);
        return toResponse(leaveRepository.save(leave), deptNameResolver.nameMap());
    }

    private LeaveResponse toResponse(Leave l, Map<Long, String> deptNames) {
        return new LeaveResponse(
                l.getId(), l.getType(), l.getStartDate(), l.getEndDate(), l.getDays(),
                l.getReason(), l.getStatus(), l.getApplicant(),
                l.getDeptId() != null ? deptNames.get(l.getDeptId()) : null,
                l.getCreatedAt());
    }
}
