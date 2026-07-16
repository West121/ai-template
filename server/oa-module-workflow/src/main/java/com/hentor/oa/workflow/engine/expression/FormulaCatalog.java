package com.hentor.oa.workflow.engine.expression;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 公式函数目录：把「取人公式专属函数」（取人 / 逻辑 / 比较）与后端可扩展的
 * {@code @FormulaFunction} 自定义函数（CUSTOM）合并成一份列表，供前端两个公式编辑器
 * （取人公式设计器、计算/条件公式设计器）动态展示。
 *
 * <p>取人/逻辑/比较项为静态清单，与 {@link com.hentor.oa.workflow.engine.FormulaEvaluator}
 * 内置函数集一一对应——改动内置取人函数时应同步此处（源真相在 FormulaEvaluator，此处仅描述）。
 * CUSTOM 项来自 {@link FormulaFunctionRegistrar} 运行时注册表，两套公式引擎共享同一批。
 */
@Component
@RequiredArgsConstructor
public class FormulaCatalog {

    private final FormulaFunctionRegistrar registrar;

    /** 取人公式内置函数（ASSIGNEE/LOGIC/COMPARE），静态清单，镜像 FormulaEvaluator。 */
    private static final List<FnMeta> BUILTINS = List.of(
            // —— 取人函数（返回用户集合）——
            new FnMeta("USER", "USER(id, ...)", "ASSIGNEE", "指定用户 id（可多个），并集为办理人"),
            new FnMeta("ROLE", "ROLE(\"角色名\")", "ASSIGNEE", "指定角色的全部成员"),
            new FnMeta("DEPT", "DEPT(部门id)", "ASSIGNEE", "指定部门的全体成员"),
            new FnMeta("POST", "POST(\"岗位名\")", "ASSIGNEE", "指定岗位的全部任职用户"),
            new FnMeta("DEPT_LEADER", "DEPT_LEADER(level)", "ASSIGNEE", "发起人部门沿上级第 level 级主管"),
            new FnMeta("INITIATOR", "INITIATOR()", "ASSIGNEE", "流程发起人本人"),
            // —— 逻辑 ——
            new FnMeta("IF", "IF(cond, a, b)", "LOGIC", "条件为真取 a，否则取 b（b 可省，省略时为空）"),
            new FnMeta("AND", "AND(x, ...)", "LOGIC", "全部为真则真（亦支持中缀 &&）"),
            new FnMeta("OR", "OR(x, ...)", "LOGIC", "任一为真则真（亦支持中缀 ||）"),
            new FnMeta("NOT", "NOT(x)", "LOGIC", "取反（亦支持中缀 !）"),
            // —— 比较运算 ——
            new FnMeta(">", "a > b", "COMPARE", "大于"),
            new FnMeta("<", "a < b", "COMPARE", "小于"),
            new FnMeta(">=", "a >= b", "COMPARE", "大于等于"),
            new FnMeta("<=", "a <= b", "COMPARE", "小于等于"),
            new FnMeta("==", "a == b", "COMPARE", "等于（数值或字符串）"),
            new FnMeta("!=", "a != b", "COMPARE", "不等于")
    );

    /**
     * 全量函数元数据：内置取人/逻辑/比较项 + 运行时注册的 {@code @FormulaFunction} 扩展函数（CUSTOM）。
     * CUSTOM 函数在取人公式与计算/条件公式两处均可用。
     */
    public List<FnMeta> listFunctions() {
        List<FnMeta> all = new ArrayList<>(BUILTINS);
        all.addAll(registrar.customFunctionMetas());
        return all;
    }
}
