package com.xingchen.oa.workflow.engine.expression;

import com.googlecode.aviator.runtime.type.AviatorFunction;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 公式自定义函数收集器：启动时扫描所有 {@link FormulaFunction} 标注的 Spring Bean，
 * 把其中实现了 Aviator {@link AviatorFunction}（如继承 {@code AbstractFunction}）的实例注册进
 * {@link ExpressionService} 的求值引擎。业务方新增函数 = 新写一个 {@code @FormulaFunction} 的
 * {@code AbstractFunction} Bean，即被自动纳入，无需改本类——「后端可自定义公式代码」的落点。
 *
 * <p>时序：{@code ExpressionService} 作为构造依赖，Spring 保证其（含引擎沙箱初始化）先于本类
 * {@code @PostConstruct} 就绪；注册在任何一次求值之前完成。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FormulaFunctionRegistrar {

    private final ExpressionService expressionService;
    private final ApplicationContext applicationContext;

    @PostConstruct
    public void registerAll() {
        Map<String, Object> beans = applicationContext.getBeansWithAnnotation(FormulaFunction.class);
        int registered = 0;
        for (Map.Entry<String, Object> entry : beans.entrySet()) {
            Object bean = entry.getValue();
            if (bean instanceof AviatorFunction fn) {
                expressionService.registerFunction(fn);
                registered++;
            } else {
                log.warn("@FormulaFunction 标注的 bean [{}] 非 AviatorFunction，已跳过（应继承 AbstractFunction）: {}",
                        entry.getKey(), bean.getClass().getName());
            }
        }
        log.info("Tier1 公式引擎自定义函数注册完成，共 {} 个", registered);
    }
}
