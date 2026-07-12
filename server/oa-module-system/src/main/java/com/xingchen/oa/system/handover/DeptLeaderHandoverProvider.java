package com.xingchen.oa.system.handover;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.system.entity.SysDept;
import com.xingchen.oa.system.entity.SysHandoverItem;
import com.xingchen.oa.system.repository.SysDeptRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 部门负责人交接（itemType=DEPT_LEADER）：把离职人负责的部门负责人改为继任者。幂等。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DeptLeaderHandoverProvider implements HandoverItemProvider {

    public static final String TYPE = "DEPT_LEADER";

    private final SysDeptRepository deptRepository;
    private final ObjectMapper objectMapper;

    @Override
    public String itemType() {
        return TYPE;
    }

    @Override
    public List<HandoverScan> scan(Long fromUserId) {
        return deptRepository.findByLeaderId(fromUserId).stream()
                .map(d -> new HandoverScan("DEPT", String.valueOf(d.getId()),
                        toJson(Map.of("deptId", d.getId(), "deptName", d.getName(), "leaderId", fromUserId)),
                        "部门负责人：" + d.getName()))
                .toList();
    }

    @Override
    public void execute(SysHandoverItem item, Long successorId) {
        if (successorId == null) {
            throw new BusinessException(400, "部门负责人交接需指定继任者");
        }
        Long deptId = Long.valueOf(item.getRefId());
        SysDept dept = deptRepository.findById(deptId)
                .orElseThrow(() -> new BusinessException(404, "部门不存在: " + deptId));
        if (Objects.equals(dept.getLeaderId(), successorId)) {
            return; // 幂等：已是继任者
        }
        dept.setLeaderId(successorId);
        deptRepository.save(dept);
    }

    private String toJson(Object v) {
        try {
            return objectMapper.writeValueAsString(v);
        } catch (Exception e) {
            return String.valueOf(v);
        }
    }
}
