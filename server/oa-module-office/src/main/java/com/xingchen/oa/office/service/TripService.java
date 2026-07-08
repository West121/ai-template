package com.xingchen.oa.office.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.office.dto.TripCreateRequest;
import com.xingchen.oa.office.dto.TripResponse;
import com.xingchen.oa.office.entity.Trip;
import com.xingchen.oa.office.repository.TripRepository;
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
public class TripService {

    private final TripRepository tripRepository;
    private final DeptNameResolver deptNameResolver;

    /**
     * 出差列表【DS】。
     */
    public PageResult<TripResponse> page(int pageNum, int pageSize) {
        Page<Trip> page = tripRepository.findAll(
                SecuritySupport.dataScope("deptId", "userId"),
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "createdAt")));
        Map<Long, String> deptNames = deptNameResolver.nameMap();
        List<TripResponse> list = page.getContent().stream()
                .map(t -> toResponse(t, deptNames))
                .toList();
        return new PageResult<>(list, page.getTotalElements(), page.getNumber() + 1, page.getSize());
    }

    @Transactional
    public TripResponse create(TripCreateRequest request) {
        UserContext context = SecuritySupport.currentUser();
        if (request.endDate().isBefore(request.startDate())) {
            throw new BusinessException(400, "结束日期不能早于开始日期");
        }
        Trip trip = new Trip();
        trip.setUserId(context.getUserId());
        trip.setApplicant(SecuritySupport.displayName(context));
        trip.setDeptId(context.getActiveDeptId());
        trip.setDestination(request.destination());
        trip.setStartDate(request.startDate());
        trip.setEndDate(request.endDate());
        trip.setTransport(request.transport());
        trip.setBudget(request.budget());
        trip.setReason(request.reason());
        trip.setStatus(Trip.STATUS_PENDING);
        return toResponse(tripRepository.save(trip), deptNameResolver.nameMap());
    }

    /**
     * 撤回：仅本人且 PENDING。
     */
    @Transactional
    public TripResponse withdraw(Long id) {
        Long userId = SecuritySupport.currentUser().getUserId();
        Trip trip = tripRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "出差申请不存在"));
        if (!Objects.equals(trip.getUserId(), userId)) {
            throw new BusinessException(403, "仅申请人本人可撤回");
        }
        if (!Trip.STATUS_PENDING.equals(trip.getStatus())) {
            throw new BusinessException(400, "仅待审批的申请可撤回");
        }
        trip.setStatus(Trip.STATUS_WITHDRAWN);
        return toResponse(tripRepository.save(trip), deptNameResolver.nameMap());
    }

    private TripResponse toResponse(Trip t, Map<Long, String> deptNames) {
        return new TripResponse(
                t.getId(), t.getDestination(), t.getStartDate(), t.getEndDate(),
                t.getTransport(), t.getBudget(), t.getReason(), t.getStatus(), t.getApplicant(),
                t.getDeptId() != null ? deptNames.get(t.getDeptId()) : null,
                t.getCreatedAt());
    }
}
