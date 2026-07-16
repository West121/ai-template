package com.hentor.oa.workflow.arch;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 架构守护：业务模块（oa-module-office / oa-module-system）源码<b>零 Flowable 引擎直调</b>。
 *
 * <p>约定（引擎收口重构后固化）：业务模块起流程/办理任务/查活动与变量一律经 workflow 的
 * {@code WfEngineFacade}；再出现 {@code import org.flowable} 或 {@code org.flowable.} 全限定引用
 * 即构建失败——防「公文/单据直调引擎」的近道再犯。守护实现为源码扫描（比 ArchUnit 轻，零新依赖）。
 *
 * <p>路径基准：surefire 的 user.dir = 本模块目录（server/oa-module-workflow），兄弟模块经 ../ 定位；
 * 模块缺失（异常布局）时按失败处理，避免静默跳过。
 */
class BusinessModuleEngineImportGuardTest {

    private static final List<String> GUARDED_MODULES = List.of("oa-module-office", "oa-module-system");

    @Test
    void businessModulesMustNotTouchFlowable() throws IOException {
        List<String> violations = new ArrayList<>();
        for (String module : GUARDED_MODULES) {
            Path src = Path.of(System.getProperty("user.dir"), "..", module, "src", "main", "java").normalize();
            assertTrue(Files.isDirectory(src), "守护目标源码目录不存在（模块布局变化？）: " + src);
            try (Stream<Path> files = Files.walk(src)) {
                files.filter(p -> p.toString().endsWith(".java")).forEach(p -> {
                    try {
                        List<String> lines = Files.readAllLines(p, StandardCharsets.UTF_8);
                        for (int i = 0; i < lines.size(); i++) {
                            String t = lines.get(i).trim();
                            if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) {
                                continue; // 注释里提及不算违规
                            }
                            if (t.contains("import org.flowable") || t.contains("org.flowable.")) {
                                violations.add(src.relativize(p) + ":" + (i + 1) + "  " + t);
                            }
                        }
                    } catch (IOException e) {
                        violations.add(p + "  <读取失败: " + e.getMessage() + ">");
                    }
                });
            }
        }
        assertTrue(violations.isEmpty(),
                "业务模块禁止直调 Flowable（请改走 workflow 的 WfEngineFacade）。违规：\n"
                        + String.join("\n", violations));
    }
}
