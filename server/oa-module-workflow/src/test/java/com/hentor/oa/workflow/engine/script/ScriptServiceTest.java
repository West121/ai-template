package com.hentor.oa.workflow.engine.script;

import com.hentor.oa.common.exception.BusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticApplicationContext;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link ScriptService} 单测（纯 JUnit，无 Spring/DB）：
 * <ul>
 *   <li>Groovy 脚本经 {@code @ScriptBean("spring")} 门面取到 Spring Bean 并调用；</li>
 *   <li>Groovy 脚本对 {@code vars} 的增改在上下文可见（供 wfScriptDelegate 回写流程变量）；</li>
 *   <li>JS（GraalJS）脚本执行并读 {@code vars}；</li>
 *   <li>执行超时（看护线程 + 中断）抛业务异常。</li>
 * </ul>
 * 说明：Python（Jython）引擎已随 {@code liteflow-script-python} 装配上 SPI，本单测按任务要求覆盖 groovy/js/超时。
 */
class ScriptServiceTest {

    /** 供脚本经 spring 门面调用的目标 Bean。 */
    public static class Greeter {
        public String greet(String who) {
            return "hello " + who;
        }
    }

    private ScriptService service;

    @BeforeEach
    void setUp() {
        StaticApplicationContext ctx = new StaticApplicationContext();
        ctx.getBeanFactory().registerSingleton("greeter", new Greeter());
        ctx.refresh();

        SpringBeanFacade facade = new SpringBeanFacade();
        facade.setApplicationContext(ctx);

        // logRepository=null → 单测跳过审计落库；超时 3s（超时用例另建短超时实例）
        service = new ScriptService(facade, new ScriptLogHelper(), null, 3000);
        service.registerScriptBeans();
    }

    @Test
    void groovyCallsSpringBeanViaFacade() {
        Object r = service.run("groovy",
                "return spring.bean('greeter').greet('磐石')",
                ScriptContext.ofVars(new HashMap<>(), "ut-groovy-bean"));
        assertEquals("hello 磐石", r, "Groovy 经 spring 门面取 Bean 并调用");
    }

    @Test
    void groovyBeanByType() {
        Object r = service.run("groovy",
                "return spring.bean(" + Greeter.class.getName() + ").greet('type')",
                ScriptContext.ofVars(new HashMap<>(), "ut-groovy-type"));
        assertEquals("hello type", r, "Groovy 经 spring 门面按类型取 Bean");
    }

    @Test
    void groovyVarsWriteBackVisible() {
        Map<String, Object> vars = new HashMap<>();
        vars.put("x", 3);
        Object r = service.run("groovy",
                "vars.put('y', vars.get('x') * 10); return vars.get('x')",
                new ScriptContext(vars, new HashMap<>(), null, "ut-groovy-vars"));
        assertEquals(3, ((Number) r).intValue());
        assertEquals(30, ((Number) vars.get("y")).intValue(), "脚本对 vars 的增改在上下文可见（供回写流程变量）");
    }

    @Test
    void jsExecutesAndReadsVars() {
        Map<String, Object> vars = new HashMap<>();
        vars.put("x", 21);
        Object r = service.run("js",
                "vars.get('x') + 21",
                new ScriptContext(vars, new HashMap<>(), null, "ut-js"));
        assertEquals(42, ((Number) r).intValue(), "JS(GraalJS) 读 vars 并返回计算值");
    }

    @Test
    void timeoutInterruptsRunawayScript() {
        // 短超时实例（300ms），脚本睡 10s → 看护线程超时中断 → 业务异常
        StaticApplicationContext ctx = new StaticApplicationContext();
        ctx.refresh();
        SpringBeanFacade facade = new SpringBeanFacade();
        facade.setApplicationContext(ctx);
        ScriptService shortTimeout = new ScriptService(facade, new ScriptLogHelper(), null, 300);
        shortTimeout.registerScriptBeans();

        BusinessException ex = assertThrows(BusinessException.class, () ->
                shortTimeout.run("groovy",
                        "Thread.sleep(10000); return 1",
                        ScriptContext.ofVars(new HashMap<>(), "ut-timeout")));
        assertTrue(ex.getMessage().contains("超时"), "运行超时抛业务异常: " + ex.getMessage());
    }

    @Test
    void unsupportedLangRejected() {
        BusinessException ex = assertThrows(BusinessException.class, () ->
                service.run("ruby", "puts 1", ScriptContext.ofVars(new HashMap<>(), "ut-lang")));
        assertTrue(ex.getMessage().contains("不支持的脚本语言"));
    }
}
