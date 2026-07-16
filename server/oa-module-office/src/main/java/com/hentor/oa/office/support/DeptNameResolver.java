package com.hentor.oa.office.support;

import com.hentor.oa.system.entity.SysDept;
import com.hentor.oa.system.repository.SysDeptRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.stream.Collectors;

/**
 * 部门名称解析：业务响应里的 deptName 统一由 dept_id 反查。
 */
@Component
@RequiredArgsConstructor
public class DeptNameResolver {

    private final SysDeptRepository deptRepository;

    public Map<Long, String> nameMap() {
        return deptRepository.findAll().stream()
                .collect(Collectors.toMap(SysDept::getId, SysDept::getName, (a, b) -> a));
    }

    public String name(Long deptId) {
        if (deptId == null) {
            return null;
        }
        return deptRepository.findById(deptId).map(SysDept::getName).orElse(null);
    }
}
