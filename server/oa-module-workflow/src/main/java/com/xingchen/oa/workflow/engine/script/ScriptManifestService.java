package com.xingchen.oa.workflow.engine.script;

import com.xingchen.oa.common.script.ScriptApi;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Service;
import org.springframework.util.ClassUtils;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 脚本上下文清单（{@code GET /api/wf/script/context-manifest}）：给前端脚本编辑器（CodeMirror）做代码提示。
 * <ul>
 *   <li>vars —— 脚本一等上下文变量（vars/form/execution/spring/log）名称/类型/说明；</li>
 *   <li>langs —— 支持语言 + return 语义；</li>
 *   <li>beans —— {@link ScriptApi} 白名单 bean 的 public 方法签名（启动扫描 + 反射枚举，懒加载缓存）。</li>
 * </ul>
 *
 * <p><b>清单只管提示、不是沙箱</b>：未标注 {@code @ScriptApi} 的 bean 脚本仍可经 {@code spring.bean(...)} 调用
 * （受信脚本全权）；本清单是「规范限定的推荐面」，运行时治理靠 {@code wf:script:write} + 审计（见 ScriptApi 注释）。
 */
@Service
@RequiredArgsConstructor
public class ScriptManifestService {

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
                + "上下文为带类型参数（Map vars/form、DelegateExecution execution、SpringBeanFacade spring、ScriptLogHelper log），"
                + "已预置 import java.util.*，其余类型用全限定名"));
        return langs;
    }

    private Map<String, Object> langEntry(String lang, String returnSemantics) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("lang", lang);
        e.put("returnSemantics", returnSemantics);
        return e;
    }

    /** @ScriptApi 白名单 bean → public 方法签名清单。 */
    private List<Map<String, Object>> beansManifest() {
        List<Map<String, Object>> beans = new ArrayList<>();
        Map<String, Object> annotated = applicationContext.getBeansWithAnnotation(ScriptApi.class);
        annotated.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(e -> beans.add(beanEntry(e.getKey(), e.getValue())));
        return beans;
    }

    private Map<String, Object> beanEntry(String beanName, Object bean) {
        Class<?> userClass = ClassUtils.getUserClass(bean); // 解代理拿真实类
        ScriptApi classAnno = userClass.getAnnotation(ScriptApi.class);
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("name", beanName);
        entry.put("className", userClass.getName());
        entry.put("desc", classAnno != null ? classAnno.value() : "");
        List<Map<String, Object>> methods = new ArrayList<>();
        java.util.Arrays.stream(userClass.getDeclaredMethods())
                .filter(m -> Modifier.isPublic(m.getModifiers()) && !m.isSynthetic() && !m.isBridge())
                .sorted(Comparator.comparing(Method::getName)
                        .thenComparing(Method::getParameterCount))
                .forEach(m -> methods.add(methodEntry(m)));
        entry.put("methods", methods);
        return entry;
    }

    private Map<String, Object> methodEntry(Method m) {
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
        ScriptApi doc = m.getAnnotation(ScriptApi.class);
        if (doc != null && !doc.value().isBlank()) {
            entry.put("doc", doc.value());
        }
        return entry;
    }
}
