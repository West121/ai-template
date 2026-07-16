package com.hentor.oa.workflow.engine.script;

import com.hentor.oa.common.script.ScriptApi;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Controller;
import org.springframework.stereotype.Repository;
import org.springframework.stereotype.Service;
import org.springframework.util.ClassUtils;
import org.springframework.web.bind.annotation.RestController;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 脚本上下文清单（{@code GET /api/wf/script/context-manifest}）：给前端脚本编辑器（CodeMirror）做代码提示。
 * <ul>
 *   <li>vars —— 脚本一等上下文变量（vars/form/execution/spring/log）名称/类型/说明；</li>
 *   <li>langs —— 支持语言 + return 语义；</li>
 *   <li>beans —— <b>双层</b>（{@code tier} 字段）：
 *     <ul>
 *       <li>{@code tier="api"} —— {@link ScriptApi} 精选白名单（<b>推荐 + 人话文档</b>，方法带 doc）；</li>
 *       <li>{@code tier="service"} —— 自动扫描的业务 Service（<b>全量可发现</b>）：com.hentor.oa 包下、
 *           类名以 Service 结尾或在 .service 包、排除 Repository/Controller/Configuration/ConfigurationProperties
 *           与已标 @ScriptApi 的；desc=类简名（无人话文档）。</li>
 *     </ul>
 *     单 bean 方法数超 {@value #METHOD_CAP} 截断并标 {@code truncated:true}（防极端类撑爆 JSON）。</li>
 *   <li>statics —— 精选静态工具类（代码内常量清单，存在于 classpath 才收）：public static 方法签名；</li>
 *   <li>imports —— Java 脚本实际预置的 import 列表（这些包下的类可直接写简名，如 {@code StringUtils.hasText}）。</li>
 * </ul>
 *
 * <p><b>清单只管提示、不是沙箱</b>：无论在不在清单，bean 都可经 {@code spring.bean(...)} 调用（受信脚本全权）。
 * api 层=「规范推荐面」，service 层=「全量可发现面」；运行时治理靠 {@code wf:script:write} + 审计（见 ScriptApi 注释）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ScriptManifestService {

    /** 单 bean/工具类方法数上限（超出截断 + truncated:true）。 */
    static final int METHOD_CAP = 80;

    /** service 层自动扫描的包前缀。 */
    private static final String BASE_PACKAGE = "com.hentor.oa";

    /** lombok @Data 等会 declared 覆盖的 Object 系方法，不进清单。 */
    private static final Set<String> OBJECT_METHODS = Set.of("equals", "hashCode", "toString");

    /**
     * 精选静态工具类候选（存在于 classpath 才收）。注意：hutool/commons-lang3 只进 statics 清单（用全限定名），
     * <b>不进</b> Java 预置 import——{@code org.apache.commons.lang3.*} 会与 {@code org.springframework.util.StringUtils}
     * 简名冲突导致编译歧义。
     */
    private static final List<String> STATIC_CLASS_CANDIDATES = List.of(
            "org.springframework.util.StringUtils",
            "org.springframework.util.CollectionUtils",
            "org.springframework.util.ObjectUtils",
            "java.util.Objects",
            "java.util.Arrays",
            "java.util.Collections",
            "java.time.LocalDate",
            "java.time.LocalDateTime",
            "java.time.Duration",
            "java.math.BigDecimal",
            "cn.hutool.core.util.StrUtil",
            "cn.hutool.core.collection.CollUtil",
            "org.apache.commons.lang3.StringUtils");

    private final ApplicationContext applicationContext;

    private volatile Map<String, Object> cached;

    public Map<String, Object> manifest() {
        Map<String, Object> m = cached;
        if (m == null) {
            m = build();
            cached = m;
        }
        return m;
    }

    private Map<String, Object> build() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("vars", varsManifest());
        out.put("langs", langsManifest());
        out.put("beans", beansManifest());
        out.put("statics", staticsManifest());
        out.put("imports", ScriptService.JAVA_PRELUDE_IMPORTS);
        return out;
    }

    /** 一等上下文变量（与 ScriptService 注入绑定一致；java 为带类型参数）。 */
    private List<Map<String, Object>> varsManifest() {
        List<Map<String, Object>> vars = new ArrayList<>();
        vars.add(varEntry("vars", "Map<String,Object>",
                "流程变量读写视图：脚本 get/put 修改，运行时回写引擎变量，影响后续网关路由/表单"));
        vars.add(varEntry("form", "Map<String,Object>", "表单数据快照（可变副本）"));
        vars.add(varEntry("execution", "DelegateExecution",
                "当前 Flowable 执行体（流程内非空；test-run 联调时为 null，注意判空）"));
        vars.add(varEntry("spring", "SpringBeanFacade",
                "Spring 容器门面：spring.bean(\"名称\")/spring.bean(类) 取任意 Bean，spring.has(\"名称\") 判存在"));
        vars.add(varEntry("log", "ScriptLogHelper", "脚本日志门面：log.info/warn/error(msg) 写应用日志（[wf-script] 前缀）"));
        return vars;
    }

    private Map<String, Object> varEntry(String name, String type, String desc) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("name", name);
        e.put("type", type);
        e.put("desc", desc);
        return e;
    }

    /** 支持语言 + return 语义（与 ScriptService 各引擎实现一致）。 */
    private List<Map<String, Object>> langsManifest() {
        List<Map<String, Object>> langs = new ArrayList<>();
        langs.add(langEntry("groovy", "最后表达式值即返回值，也支持显式 return"));
        langs.add(langEntry("js", "最后表达式值即返回值（GraalJS；不支持顶层 return）"));
        langs.add(langEntry("python", "Jython(JSR223)；建议把结果写入 vars（表达式返回语义弱）"));
        langs.add(langEntry("java", "真 Java（javax.tools 运行期编译，Liquor）：方法体语法，须显式 return（无返回写 return null;）；"
                + "上下文为带类型参数（Map vars/form、DelegateExecution execution、SpringBeanFacade spring、ScriptLogHelper log）；"
                + "预置 import 见 manifest.imports（这些包下类可直接写简名），其余类型用全限定名"));
        return langs;
    }

    private Map<String, Object> langEntry(String lang, String returnSemantics) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("lang", lang);
        e.put("returnSemantics", returnSemantics);
        return e;
    }

    // ==================== beans（双层：api 精选 + service 自动扫描） ====================

    private List<Map<String, Object>> beansManifest() {
        List<Map<String, Object>> beans = new ArrayList<>();
        // tier=api：@ScriptApi 精选（推荐 + 人话文档），置前
        Map<String, Object> annotated = applicationContext.getBeansWithAnnotation(ScriptApi.class);
        Set<String> apiClasses = new LinkedHashSet<>();
        annotated.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(e -> {
                    Class<?> userClass = ClassUtils.getUserClass(e.getValue());
                    apiClasses.add(userClass.getName());
                    beans.add(beanEntry(e.getKey(), userClass, "api",
                            annoValue(userClass), true));
                });
        // tier=service：自动扫描业务 Service（全量可发现，无人话文档）
        Set<String> seenClasses = new LinkedHashSet<>(apiClasses);
        List<Map.Entry<String, Class<?>>> serviceBeans = new ArrayList<>();
        for (String beanName : applicationContext.getBeanDefinitionNames()) {
            Class<?> userClass = safeUserClass(beanName);
            if (userClass == null || !isBusinessService(userClass) || !seenClasses.add(userClass.getName())) {
                continue;
            }
            serviceBeans.add(Map.entry(beanName, userClass));
        }
        serviceBeans.stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(e -> beans.add(beanEntry(e.getKey(), e.getValue(), "service",
                        e.getValue().getSimpleName(), false)));
        return beans;
    }

    private String annoValue(Class<?> userClass) {
        ScriptApi a = userClass.getAnnotation(ScriptApi.class);
        return a != null ? a.value() : "";
    }

    /** bean 类型解析（不触发实例化副作用；解析失败跳过）。 */
    private Class<?> safeUserClass(String beanName) {
        try {
            Class<?> type = applicationContext.getType(beanName);
            if (type == null) {
                return null;
            }
            Class<?> userClass = ClassUtils.getUserClass(type);
            // JDK 动态代理类（$Proxy）无业务方法信息，跳过
            return java.lang.reflect.Proxy.isProxyClass(userClass) ? null : userClass;
        } catch (Exception e) {
            return null;
        }
    }

    /** service 层准入：本项目包 + Service 命名/包约定 + 排除数据/web/配置组件。 */
    private boolean isBusinessService(Class<?> c) {
        String pkg = c.getPackageName();
        if (!pkg.startsWith(BASE_PACKAGE)) {
            return false;
        }
        if (!(c.getSimpleName().endsWith("Service") || pkg.contains(".service"))) {
            return false;
        }
        if (c.isInterface() || c.isAnnotation() || c.isEnum()) {
            return false;
        }
        return !c.isAnnotationPresent(Repository.class)
                && !c.isAnnotationPresent(Controller.class)
                && !c.isAnnotationPresent(RestController.class)
                && !c.isAnnotationPresent(Configuration.class)
                && !c.isAnnotationPresent(ConfigurationProperties.class);
    }

    private Map<String, Object> beanEntry(String beanName, Class<?> userClass, String tier,
                                          String desc, boolean withDoc) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("name", beanName);
        entry.put("className", userClass.getName());
        entry.put("desc", desc);
        entry.put("tier", tier);
        List<Method> all = java.util.Arrays.stream(userClass.getDeclaredMethods())
                .filter(m -> Modifier.isPublic(m.getModifiers()) && !m.isSynthetic() && !m.isBridge()
                        && !OBJECT_METHODS.contains(m.getName()))
                .sorted(Comparator.comparing(Method::getName).thenComparing(Method::getParameterCount))
                .toList();
        List<Map<String, Object>> methods = new ArrayList<>();
        all.stream().limit(METHOD_CAP).forEach(m -> methods.add(methodEntry(m, withDoc)));
        entry.put("methods", methods);
        if (all.size() > METHOD_CAP) {
            entry.put("truncated", true);
        }
        return entry;
    }

    private Map<String, Object> methodEntry(Method m, boolean withDoc) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("name", m.getName());
        List<Map<String, Object>> params = new ArrayList<>();
        for (Parameter p : m.getParameters()) {
            Map<String, Object> pe = new LinkedHashMap<>();
            if (p.isNamePresent()) { // 需 -parameters 编译参数；缺省仅出类型
                pe.put("name", p.getName());
            }
            pe.put("type", p.getType().getSimpleName());
            params.add(pe);
        }
        entry.put("params", params);
        entry.put("returnType", m.getReturnType().getSimpleName());
        if (withDoc) {
            ScriptApi doc = m.getAnnotation(ScriptApi.class);
            if (doc != null && !doc.value().isBlank()) {
                entry.put("doc", doc.value());
            }
        }
        return entry;
    }

    // ==================== statics（精选静态工具类） ====================

    /** 精选工具类 → public static 方法签名（classpath 存在才收；同 METHOD_CAP 截断）。 */
    private List<Map<String, Object>> staticsManifest() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (String className : STATIC_CLASS_CANDIDATES) {
            Class<?> c;
            try {
                c = Class.forName(className);
            } catch (Throwable t) {
                continue; // 不在 classpath（如未引 hutool/commons）→ 跳过
            }
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("simpleName", c.getSimpleName());
            entry.put("className", c.getName());
            List<Method> all = java.util.Arrays.stream(c.getDeclaredMethods())
                    .filter(m -> Modifier.isPublic(m.getModifiers()) && Modifier.isStatic(m.getModifiers())
                            && !m.isSynthetic() && !m.isBridge() && !OBJECT_METHODS.contains(m.getName()))
                    .sorted(Comparator.comparing(Method::getName).thenComparing(Method::getParameterCount))
                    .toList();
            List<Map<String, Object>> methods = new ArrayList<>();
            all.stream().limit(METHOD_CAP).forEach(m -> methods.add(methodEntry(m, false)));
            entry.put("methods", methods);
            if (all.size() > METHOD_CAP) {
                entry.put("truncated", true);
            }
            out.add(entry);
        }
        return out;
    }
}
