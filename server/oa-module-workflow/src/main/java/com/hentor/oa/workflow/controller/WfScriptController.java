package com.hentor.oa.workflow.controller;

import com.hentor.oa.common.core.R;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.workflow.dto.ScriptTestRunRequest;
import com.hentor.oa.workflow.dto.ScriptTestRunResult;
import com.hentor.oa.workflow.engine.script.ScriptContext;
import com.hentor.oa.workflow.engine.script.ScriptManifestService;
import com.hentor.oa.workflow.engine.script.ScriptService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

/**
 * Tier 2 脚本联调端点。仅 {@code wf:script:write}（管理员）可用——脚本以应用完整权限运行、非沙箱，
 * 治理红线要求作者权限收口。测试运行同权限、同审计（{@link ScriptService#run} 内落 {@code wf_script_exec_log}）。
 */
@RestController
@RequestMapping("/api/wf/script")
@RequiredArgsConstructor
public class WfScriptController {

    private final ScriptService scriptService;
    private final ScriptManifestService manifestService;

    /**
     * 脚本上下文清单（编辑器代码提示源）：{@code {vars, langs, beans}}。
     * 同 {@code wf:script:write} 门槛——编辑器本就只对脚本作者开放，清单披露内部方法签名，同一信任面。
     */
    @GetMapping("/context-manifest")
    @PreAuthorize("hasAuthority('wf:script:write')")
    public R<Map<String, Object>> contextManifest() {
        return R.ok(manifestService.manifest());
    }

    /**
     * 测试运行：给脚本编辑器联调。执行成功返回值/回写变量，失败返回错误串（均以 R.ok 承载 + 已审计）。
     */
    @PostMapping("/test-run")
    @PreAuthorize("hasAuthority('wf:script:write')")
    public R<ScriptTestRunResult> testRun(@Valid @RequestBody ScriptTestRunRequest req) {
        Map<String, Object> vars = req.sampleVars == null ? new HashMap<>() : new HashMap<>(req.sampleVars);
        long start = System.currentTimeMillis();
        try {
            Object result = scriptService.run(req.lang, req.code, ScriptContext.ofVars(vars, "test-run"));
            return R.ok(ScriptTestRunResult.ok(result, vars, System.currentTimeMillis() - start));
        } catch (BusinessException e) {
            // 编译/运行/超时错误回给编辑器展示（非 HTTP 错误）；已在 ScriptService 内落失败审计
            return R.ok(ScriptTestRunResult.fail(e.getMessage(), System.currentTimeMillis() - start));
        }
    }
}
