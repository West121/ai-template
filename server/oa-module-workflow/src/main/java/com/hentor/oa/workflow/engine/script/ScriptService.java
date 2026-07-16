package com.hentor.oa.workflow.engine.script;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.CurrentUserHolder;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.workflow.entity.WfScriptExecLog;
import com.hentor.oa.workflow.repository.WfScriptExecLogRepository;
import com.yomahub.liteflow.script.ScriptBeanManager;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Source;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.script.Bindings;
import javax.script.ScriptEngine;
import javax.script.ScriptEngineManager;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Tier 2 脚本执行封装：多语言脚本 + 统一上下文 + {@code @ScriptBean} 门面 + 执行超时（看护线程 + 中断）+ 全量审计。
 *
 * <h3>为何这样封装 LiteFlow</h3>
 * 本项目用 LiteFlow 作 Tier 2 脚本引擎（依赖 {@code liteflow-script-groovy/-graaljs/-python} 带来
 * Groovy / GraalJS / Jython 三套引擎与 {@code @ScriptBean} 门面注册表 {@link ScriptBeanManager}），
 * 但<b>不</b>用它的链路编排（{@code liteflow.enable=false}）。LiteFlow 的 {@code ScriptExecutor.executeScript}
 * 绑定参数时强依赖 DataBus Slot + NodeComponent（只在一条 chain 执行内成立），无法独立调用；
 * 三引擎底层模型又各异（Groovy=JSR223 / Jython=PythonInterpreter / GraalJS=polyglot），无统一 compile 产物。
 * 因此 {@link ScriptService} 直接驱动 LiteFlow 所带的引擎执行：
 * <ul>
 *   <li>groovy / python → JSR223（{@link ScriptEngineManager}，last-expression 返回、支持 {@code return}）；</li>
 *   <li>js → GraalVM polyglot（{@code Context.allowAllAccess(true)}，与 LiteFlow 的 GraalJS 执行同构）；</li>
 * </ul>
 * 三路均把 {@link ScriptBeanManager#getScriptBeanMap()}（{@code spring}/{@code log} 门面）+ 一等上下文
 * （{@code vars}/{@code form}/{@code execution}）注入脚本绑定——{@code @ScriptBean} 语义完整保留。
 *
 * <h3>安全边界（诚实标注 §3.3 第 4 条）</h3>
 * <b>后端脚本以应用完整权限运行（{@code spring.bean(...)} 可达整个容器），等同把 Java 代码提交进仓库，不是沙箱。</b>
 * 超时/限额只防 bug（死循环），不防作者恶意。治理靠：{@code wf:script:write}（仅管理员可写）+ 部署态工件
 * （不接受运行时用户注入）+ 本类每次执行落 {@code wf_script_exec_log} 审计。
 */
@Slf4j
@Service
public class ScriptService {

    private static final String LANG_GROOVY = "groovy";
    private static final String LANG_PYTHON = "python";
    private static final String LANG_JS = "js";
    private static final String LANG_JAVA = "java";

    /**
     * Java 脚本预置 import（与 {@code manifest.imports} 对齐——这些包下的类脚本里直接写简名，
     * 如 {@code StringUtils.hasText(x)}/{@code LocalDate.now()}/{@code new BigDecimal("1")}）。
     * <b>勿加</b> {@code org.apache.commons.lang3.*}/hutool 通配——与 spring 的 StringUtils/CollectionUtils
     * 简名歧义会编译失败；commons/hutool 用全限定名（statics 清单里有 className）。
     */
    public static final java.util.List<String> JAVA_PRELUDE_IMPORTS = java.util.List.of(
            "java.util.*", "java.time.*", "java.math.*", "org.springframework.util.*");

    /** 输入语言别名 → 规范语言。 */
    private static final Map<String, String> LANG_ALIAS = Map.of(
            "groovy", LANG_GROOVY,
            "python", LANG_PYTHON,
            "jython", LANG_PYTHON,
            "js", LANG_JS,
            "javascript", LANG_JS,
            "java", LANG_JAVA);

    private final SpringBeanFacade springFacade;
    private final ScriptLogHelper logHelper;
    /** 审计仓库；单测可为 null（跳过落库，仅执行）。 */
    private final WfScriptExecLogRepository logRepository;
    private final long timeoutMs;

    /** 看护线程池：单脚本执行放子线程，主线程 future.get(timeout) 到点中断（daemon，不阻塞 JVM 退出）。 */
    private final ExecutorService pool = Executors.newCachedThreadPool(new ThreadFactory() {
        private final AtomicInteger seq = new AtomicInteger();
        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "wf-script-" + seq.incrementAndGet());
            t.setDaemon(true);
            return t;
        }
    });

    public ScriptService(SpringBeanFacade springFacade,
                         ScriptLogHelper logHelper,
                         WfScriptExecLogRepository logRepository,
                         @Value("${oa.wf.script.timeout-ms:5000}") long timeoutMs) {
        this.springFacade = springFacade;
        this.logHelper = logHelper;
        this.logRepository = logRepository;
        this.timeoutMs = timeoutMs > 0 ? timeoutMs : 5000;
    }

    /**
     * 注册 {@code @ScriptBean} 门面到 LiteFlow 全局脚本 bean 表（{@code spring} / {@code log}）。
     * 因 {@code liteflow.enable=false} 关闭了组件扫描，这里显式登记，与装配顺序无关、幂等。
     * 单测中同名手动调用即可拿到门面。
     */
    @PostConstruct
    public void registerScriptBeans() {
        ScriptBeanManager.addScriptBean("spring", springFacade);
        ScriptBeanManager.addScriptBean("log", logHelper);
    }

    /**
     * 执行一段脚本。
     *
     * @param lang groovy / js（javascript）/ python
     * @param code 脚本体
     * @param ctx  统一上下文（vars/form/execution/scriptRef）
     * @return 脚本返回值（各引擎最后表达式值 / 显式 return）
     * @throws BusinessException 语言不支持、编译失败、执行异常或超时（均已落审计）
     */
    public Object run(String lang, String code, ScriptContext ctx) {
        String canonical = resolveLang(lang);
        String source = ctx.execution != null ? WfScriptExecLog.SOURCE_TASK : WfScriptExecLog.SOURCE_TEST_RUN;
        String scriptRef = ctx.scriptRef;
        // 审计的 who 取自当前请求线程（下沉到子线程前抓取）
        UserContext u = CurrentUserHolder.get();

        long start = System.currentTimeMillis();
        try {
            Object result = executeWithTimeout(canonical, code, ctx);
            audit(u, scriptRef, canonical, source, true, System.currentTimeMillis() - start, null);
            return result;
        } catch (BusinessException e) {
            audit(u, scriptRef, canonical, source, false, System.currentTimeMillis() - start, e.getMessage());
            throw e;
        } catch (Exception e) {
            audit(u, scriptRef, canonical, source, false, System.currentTimeMillis() - start, e.getMessage());
            throw new BusinessException(400, "脚本执行失败: " + e.getMessage());
        }
    }

    /** 看护线程执行 + 超时中断。 */
    private Object executeWithTimeout(String lang, String code, ScriptContext ctx) {
        if (code == null || code.isBlank()) {
            throw new BusinessException(400, "脚本体为空");
        }
        Callable<Object> task = switch (lang) {
            case LANG_JS -> () -> runJs(code, ctx);
            case LANG_JAVA -> () -> runJava(code, ctx);
            default -> () -> runJsr223(lang, code, ctx);
        };
        Future<Object> future = pool.submit(task);
        try {
            return future.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            future.cancel(true); // 中断看护线程（best-effort：引擎对中断的响应因语言而异）
            throw new BusinessException(400, "脚本执行超时（>" + timeoutMs + "ms）");
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw new BusinessException(400, "脚本执行被中断");
        } catch (java.util.concurrent.ExecutionException e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            if (cause instanceof BusinessException be) {
                throw be;
            }
            throw new BusinessException(400, "脚本执行异常: " + cause.getMessage());
        }
    }

    /** groovy / python：JSR223 引擎（LiteFlow 所带 groovy-jsr223 / jython）。 */
    private Object runJsr223(String engineName, String code, ScriptContext ctx) throws Exception {
        ScriptEngine engine = new ScriptEngineManager().getEngineByName(engineName);
        if (engine == null) {
            throw new BusinessException(400, "脚本引擎不可用（未装配 JSR223 引擎）: " + engineName);
        }
        Bindings bindings = engine.createBindings();
        bindings.putAll(ScriptBeanManager.getScriptBeanMap()); // spring / log 门面
        bindings.put("vars", ctx.vars);
        bindings.put("form", ctx.form);
        bindings.put("execution", ctx.execution);
        return engine.eval(code, bindings);
    }

    /**
     * js：GraalVM polyglot。{@code allowAllAccess(true)} 放通宿主访问（脚本可调 {@code spring.bean(...)}），
     * 与 LiteFlow 的 GraalJS 执行同构。每次执行独立 Context，天然线程安全。
     * 约定：JS 用最后语句值 / 表达式作返回，不支持顶层 {@code return}。
     */
    private Object runJs(String code, ScriptContext ctx) {
        try (Context context = Context.newBuilder("js").allowAllAccess(true).build()) {
            org.graalvm.polyglot.Value binding = context.getBindings("js");
            ScriptBeanManager.getScriptBeanMap().forEach(binding::putMember);
            binding.putMember("vars", ctx.vars);
            binding.putMember("form", ctx.form);
            binding.putMember("execution", ctx.execution);
            org.graalvm.polyglot.Value r = context.eval(Source.create("js", code));
            return toJava(r);
        }
    }

    private Object toJava(org.graalvm.polyglot.Value v) {
        if (v == null || v.isNull()) {
            return null;
        }
        if (v.isHostObject()) {
            return v.asHostObject();
        }
        return v.as(Object.class);
    }

    /**
     * java：真 Java（Liquor，{@code liteflow-script-javax-pro} 底层编译器，运行期 {@code javax.tools} 编译，需 JDK 运行时）。
     *
     * <p><b>与 LiteFlow javax-pro 原生脚本格式的差异（刻意为之）</b>：LiteFlow 官方 java 脚本要求写完整类
     * {@code extends NodeComponent} 并实现 {@code process()}——该模型绑定 chain/DataBus Slot，而本项目
     * {@code liteflow.enable=false} 不走链路编排（见类注释）。故与 groovy 等同构：直接驱动其底层编译器，
     * 脚本为<b>方法体</b>（语句 + 显式 {@code return}，无 return 语义的脚本请 {@code return null;}），
     * 上下文以<b>带类型参数</b>注入：{@code Map vars / Map form / DelegateExecution execution /
     * SpringBeanFacade spring / ScriptLogHelper log}（与 groovy 同名同义，静态类型直接点方法，无需取绑定）；
     * 预置 import 见 {@link #JAVA_PRELUDE_IMPORTS}。编译产物按代码缓存（CodeSpec.cached）。
     */
    private Object runJava(String code, ScriptContext ctx) {
        java.util.List<org.noear.liquor.eval.ParamSpec> params = new java.util.ArrayList<>();
        Map<String, Object> args = new java.util.LinkedHashMap<>();
        params.add(new org.noear.liquor.eval.ParamSpec("vars", Map.class));
        args.put("vars", ctx.vars);
        params.add(new org.noear.liquor.eval.ParamSpec("form", Map.class));
        args.put("form", ctx.form);
        params.add(new org.noear.liquor.eval.ParamSpec("execution", org.flowable.engine.delegate.DelegateExecution.class));
        args.put("execution", ctx.execution);
        // @ScriptBean 门面（spring/log…）：按各自真实类型声明参数，脚本内静态类型直接调用
        ScriptBeanManager.getScriptBeanMap().forEach((name, bean) -> {
            params.add(new org.noear.liquor.eval.ParamSpec(name, bean.getClass()));
            args.put(name, bean);
        });
        org.noear.liquor.eval.CodeSpec spec = new org.noear.liquor.eval.CodeSpec(code)
                .imports(JAVA_PRELUDE_IMPORTS.toArray(new String[0])) // 预置 import（与 manifest.imports 对齐）
                .parameters(params.toArray(new org.noear.liquor.eval.ParamSpec[0]))
                .returnType(Object.class) // 生成方法返回 Object：脚本须显式 return（无返回写 return null;）
                .cached(true);
        try {
            return org.noear.liquor.eval.Scripts.eval(spec, args);
        } catch (Exception e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            throw new BusinessException(400, "Java 脚本编译/执行失败: " + cause.getMessage());
        }
    }

    private String resolveLang(String lang) {
        String key = lang == null ? "" : lang.trim().toLowerCase();
        String canonical = LANG_ALIAS.get(key);
        if (canonical == null) {
            throw new BusinessException(400, "不支持的脚本语言（仅 groovy/js/python/java）: " + lang);
        }
        return canonical;
    }

    private void audit(UserContext u, String scriptRef, String lang, String source,
                       boolean success, long costMs, String errorMsg) {
        if (logRepository == null) {
            return; // 单测 / 无持久化场景
        }
        try {
            WfScriptExecLog rec = new WfScriptExecLog();
            rec.setActorId(u != null ? u.getUserId() : null);
            rec.setActorName(u != null ? u.getName() : "系统");
            rec.setScriptRef(scriptRef);
            rec.setLang(lang);
            rec.setSource(source);
            rec.setSuccess(success);
            rec.setCostMs(costMs);
            rec.setErrorMsg(errorMsg);
            logRepository.save(rec);
        } catch (Exception e) {
            // 审计失败不得影响主流程；仅记应用日志
            log.warn("脚本执行审计落库失败 ref={} lang={} err={}", scriptRef, lang, e.getMessage());
        }
    }
}
