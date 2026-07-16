package com.hentor.oa.workflow.controller;

import com.hentor.oa.common.core.R;
import com.hentor.oa.workflow.engine.expression.ExpressionService;
import com.hentor.oa.workflow.engine.expression.FnMeta;
import com.hentor.oa.workflow.engine.expression.FormulaCatalog;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Tier 1 公式调试端点（管理员）：供前端公式设计器/联调即时试算表达式。
 * 仅 {@code wf:instance:admin}（流程管理员）可用——表达式虽有沙箱，仍限受信人调试。
 */
@RestController
@RequestMapping("/api/wf/expression")
@RequiredArgsConstructor
public class ExpressionController {

    private final ExpressionService expressionService;
    private final FormulaCatalog formulaCatalog;

    /**
     * 公式函数列表（登录即可）：取人/逻辑/比较内置项 + 后端可扩展的 {@code @FormulaFunction} 函数（CUSTOM），
     * 供前端「取人公式」与「计算/条件公式」两个编辑器动态展示。两套公式共享同一批 CUSTOM 函数。
     */
    @GetMapping("/functions")
    @PreAuthorize("isAuthenticated()")
    public R<List<FnMeta>> functions() {
        return R.ok(formulaCatalog.listFunctions());
    }

    /**
     * 求值表达式。请求体：{@code {expr:"...", context:{字段:值,...}, asBoolean?:true}}。
     * 返回原始结果对象；{@code asBoolean=true} 时按真值语义返回 boolean。
     */
    @PostMapping("/eval")
    @PreAuthorize("hasAuthority('wf:instance:admin')")
    public R<Object> eval(@RequestBody EvalRequest req) {
        Map<String, Object> ctx = req.context() == null ? Map.of() : req.context();
        if (Boolean.TRUE.equals(req.asBoolean())) {
            return R.ok(expressionService.evalBoolean(req.expr(), ctx));
        }
        return R.ok(expressionService.eval(req.expr(), ctx));
    }

    /** 调试求值入参。 */
    public record EvalRequest(String expr, Map<String, Object> context, Boolean asBoolean) {
    }
}
