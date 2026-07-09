package com.xingchen.oa.workflow.engine.expression.functions;

import com.googlecode.aviator.runtime.function.AbstractFunction;
import com.googlecode.aviator.runtime.function.FunctionUtils;
import com.googlecode.aviator.runtime.type.AviatorNil;
import com.googlecode.aviator.runtime.type.AviatorObject;
import com.googlecode.aviator.runtime.type.AviatorRuntimeJavaType;
import com.xingchen.oa.system.entity.SysDept;
import com.xingchen.oa.system.entity.SysUserAssignment;
import com.xingchen.oa.system.repository.SysDeptRepository;
import com.xingchen.oa.system.repository.SysUserAssignmentRepository;
import com.xingchen.oa.workflow.engine.expression.FormulaFunction;
import lombok.RequiredArgsConstructor;

import java.util.Map;

/**
 * 公式函数 {@code deptLeader(userId)}：返回该用户主任职部门的负责人用户 id（Long），无则 nil。
 * 示例 Tier1 白名单纯函数——只读组织数据、无副作用，证明「后端可自定义公式代码」。
 *
 * <p>用法：{@code deptLeader(applicantId) == managerId} 一类高级条件；或表单计算字段取审批人。
 */
@FormulaFunction("deptLeader(userId) → 用户主任职部门负责人 id")
@RequiredArgsConstructor
public class DeptLeaderFunction extends AbstractFunction {

    private final SysUserAssignmentRepository assignmentRepository;
    private final SysDeptRepository deptRepository;

    @Override
    public String getName() {
        return "deptLeader";
    }

    @Override
    public AviatorObject call(Map<String, Object> env, AviatorObject arg1) {
        Number userIdNum = FunctionUtils.getNumberValue(arg1, env);
        if (userIdNum == null) {
            return AviatorNil.NIL;
        }
        Long userId = userIdNum.longValue();
        Long deptId = assignmentRepository.findByUserIdAndEnabledTrueOrderByPrimaryFlagDescIdAsc(userId)
                .stream()
                .findFirst()
                .map(SysUserAssignment::getDept)
                .map(SysDept::getId)
                .orElse(null);
        if (deptId == null) {
            return AviatorNil.NIL;
        }
        Long leaderId = deptRepository.findById(deptId).map(SysDept::getLeaderId).orElse(null);
        return leaderId == null ? AviatorNil.NIL : AviatorRuntimeJavaType.valueOf(leaderId);
    }
}
