package com.xingchen.oa.workflow.engine.script;

import com.yomahub.liteflow.script.annotation.ScriptBean;
import org.springframework.beans.BeansException;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationContextAware;
import org.springframework.stereotype.Component;

/**
 * 脚本侧「Spring 全量可达」门面，脚本内以变量名 {@code spring} 访问（LiteFlow {@code @ScriptBean("spring")}）。
 *
 * <p>设计依据（{@code docs/design/next-gen-workflow-and-formula.md} §3.2 Tier 2）：LiteFlow 的
 * 「显式暴露」模型是治理优势——脚本只能调被刻意放出来的门面。本门面包裹 {@link ApplicationContext}，
 * 让最高信任脚本按名/按类型取任意 Spring Bean 并调用（{@code spring.bean("xxx")} / {@code spring.bean(X.class)}）。
 *
 * <p><b>诚实标注（§3.3 第 4 条）：这等于把整个应用容器开放给脚本——后端脚本以应用完整权限运行，非沙箱。</b>
 * 故写脚本需 {@code wf:script:write}（仅管理员），且每次执行落审计（{@code wf_script_exec_log}）。
 *
 * <p>注册路径（双保险，与装配顺序无关）：① 本类 {@code @ScriptBean("spring")} 供 LiteFlow 组件扫描登记（若开启）；
 * ② {@link ScriptService} 启动时显式 {@code ScriptBeanManager.addScriptBean("spring", this)}——因本项目
 * {@code liteflow.enable=false} 关闭了组件扫描，实际以 ② 为准。
 */
@Component
@ScriptBean("spring")
public class SpringBeanFacade implements ApplicationContextAware {

    private ApplicationContext applicationContext;

    @Override
    public void setApplicationContext(ApplicationContext applicationContext) throws BeansException {
        this.applicationContext = applicationContext;
    }

    /** 按 bean 名取 Spring Bean（脚本：{@code spring.bean("wfVote")}）。 */
    public Object bean(String name) {
        return applicationContext.getBean(name);
    }

    /** 按类型取 Spring Bean（脚本：{@code spring.bean(com.xxx.Svc.class)}）。 */
    public <T> T bean(Class<T> type) {
        return applicationContext.getBean(type);
    }

    /** 是否存在指定名的 Bean（供脚本条件判断，避免直接 getBean 抛异常）。 */
    public boolean has(String name) {
        return applicationContext != null && applicationContext.containsBean(name);
    }
}
