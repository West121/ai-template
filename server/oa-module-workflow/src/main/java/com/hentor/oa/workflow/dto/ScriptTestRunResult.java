package com.hentor.oa.workflow.dto;

import java.util.Map;

/**
 * 脚本测试运行结果：执行成功返回值 + 类型 + 耗时 + 回写后的样例变量；失败返回错误信息。
 * 无论成功失败均以 {@code R.ok} 承载（success 标志区分），便于前端编辑器统一展示编译/运行错误。
 */
public class ScriptTestRunResult {

    public boolean success;
    /** 脚本返回值的字符串化（避免复杂对象序列化失败） */
    public String result;
    /** 返回值运行时类型名（null 表示无返回值） */
    public String resultType;
    /** 执行完毕后的样例变量视图（脚本对 vars 的增改可见） */
    public Map<String, Object> vars;
    /** 执行耗时（毫秒） */
    public long costMs;
    /** 失败原因（成功为空） */
    public String error;

    public static ScriptTestRunResult ok(Object value, Map<String, Object> vars, long costMs) {
        ScriptTestRunResult r = new ScriptTestRunResult();
        r.success = true;
        r.result = value == null ? null : String.valueOf(value);
        r.resultType = value == null ? null : value.getClass().getName();
        r.vars = vars;
        r.costMs = costMs;
        return r;
    }

    public static ScriptTestRunResult fail(String error, long costMs) {
        ScriptTestRunResult r = new ScriptTestRunResult();
        r.success = false;
        r.error = error;
        r.costMs = costMs;
        return r;
    }
}
