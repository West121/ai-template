package com.xingchen.oa.workflow.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.workflow.engine.expression.ExpressionService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

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
