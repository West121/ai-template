package com.xingchen.oa.workflow.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.Map;

/**
 * 脚本测试运行请求（{@code POST /api/wf/script/test-run}）：供前端脚本编辑器联调。
 * {@code sampleVars} 为样例流程变量（脚本内以 {@code vars} 读写），可空。
 */
public class ScriptTestRunRequest {

    @NotBlank
    public String lang;

    @NotBlank
    public String code;

    public Map<String, Object> sampleVars;
}
