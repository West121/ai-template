package com.hentor.oa.workflow.engine.expression;

import com.googlecode.aviator.runtime.type.AviatorFunction;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.ApplicationContext;
import org.springframework.core.annotation.AnnotationUtils;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 公式自定义函数收集器：启动时扫描所有 {@link FormulaFunction} 标注的 Spring Bean，
 * 把其中实现了 Aviator {@link AviatorFunction}（如继承 {@code AbstractFunction}）的实例注册进
 * {@link ExpressionService} 的求值引擎。业务方新增函数 = 新写一个 {@code @FormulaFunction} 的
 * {@code AbstractFunction} Bean，即被自动纳入，无需改本类——「后端可自定义公式代码」的落点。
 *
 * <p>除注册进 Aviator 引擎（供计算/条件公式）外，本类另维护一份「函数名 → 元数据」注册表，
 * 供：①「取人公式」{@code FormulaEvaluator} 把它不认识的函数名委托到本批扩展函数求值
 * （{@link #hasFunction}）；② 函数列表端点 {@code GET /api/wf/expression/functions} 动态展示
 * （{@link #customFunctionMetas}）。两套公式由此共享同一批可扩展函数。
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

    /** 函数名 → 元数据（保持注册顺序），CUSTOM 分类。启动期一次性填充，之后只读。 */
    private final Map<String, FnMeta> customFunctions = new LinkedHashMap<>();

    @PostConstruct
    public void registerAll() {
        Map<String, Object> beans = applicationContext.getBeansWithAnnotation(FormulaFunction.class);
        int registered = 0;
        for (Map.Entry<String, Object> entry : beans.entrySet()) {
            Object bean = entry.getValue();
            if (bean instanceof AviatorFunction fn) {
                expressionService.registerFunction(fn);
                customFunctions.put(fn.getName(), toMeta(fn.getName(), bean));
                registered++;
            } else {
                log.warn("@FormulaFunction 标注的 bean [{}] 非 AviatorFunction，已跳过（应继承 AbstractFunction）: {}",
                        entry.getKey(), bean.getClass().getName());
            }
        }
        log.info("Tier1 公式引擎自定义函数注册完成，共 {} 个", registered);
    }

    /** 该名称是否为已注册的可扩展自定义函数（供取人公式委托判定）。 */
    public boolean hasFunction(String name) {
        return name != null && customFunctions.containsKey(name);
    }

    /** 全部自定义函数元数据（CUSTOM 分类），供函数列表端点合并。 */
    public List<FnMeta> customFunctionMetas() {
        return new ArrayList<>(customFunctions.values());
    }

    /**
     * 由 {@code @FormulaFunction} 注解描述构造元数据。注解 value 约定形如
     * {@code "workDays(start, end) → 说明"}：{@code →} 前为签名、后为说明；无 {@code →} 时
     * 签名退化为 {@code name(...)}、整串作说明。
     */
    private FnMeta toMeta(String name, Object bean) {
        FormulaFunction ann = AnnotationUtils.findAnnotation(AopUtils.getTargetClass(bean), FormulaFunction.class);
        String desc = ann == null ? "" : ann.value();
        String signature = name + "(...)";
        String description = desc;
        int arrow = desc.indexOf('→');
        if (arrow >= 0) {
            signature = desc.substring(0, arrow).trim();
            description = desc.substring(arrow + 1).trim();
        } else if (desc.isBlank()) {
            description = "";
        }
        return new FnMeta(name, signature, "CUSTOM", description);
    }
}
