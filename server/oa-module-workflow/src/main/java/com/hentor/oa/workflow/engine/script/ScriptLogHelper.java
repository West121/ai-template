package com.hentor.oa.workflow.engine.script;

import com.yomahub.liteflow.script.annotation.ScriptBean;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 脚本侧日志门面，脚本内以变量名 {@code log} 访问（LiteFlow {@code @ScriptBean("log")}）。
 * 统一打到后端应用日志（前缀 {@code [wf-script]}），供运行日志 tail 追溯脚本行为。
 */
@Slf4j
@Component
@ScriptBean("log")
public class ScriptLogHelper {

    public void info(Object msg) {
        log.info("[wf-script] {}", msg);
    }

    public void warn(Object msg) {
        log.warn("[wf-script] {}", msg);
    }

    public void error(Object msg) {
        log.error("[wf-script] {}", msg);
    }
}
