package com.xingchen.oa.workflow.orch.engine.nodes;

import com.xingchen.oa.workflow.orch.engine.OrchRunContext;
import com.xingchen.oa.workflow.orch.engine.OrchSpringHolder;
import com.xingchen.oa.workflow.orch.engine.OrchTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;

import javax.sql.DataSource;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * dbQuery 节点（§9.5，批4裁定：<b>本应用库只读 + select-only 硬校验</b>）：
 * config {sql(静态 SQL，不做模板插值——注入面收口), params?:[Aviator 表达式]（按序绑定 ?），
 * maxRows?(默认/上限 1000), timeoutMs?(默认 5s，上限 30s), saveAs}。
 * 校验：单语句（无分号）、必须以 SELECT/WITH 开头、黑名单 DML/DDL 关键字硬拒。
 * 外部 JDBC 数据源：凭据化扩展点（credentialId type=JDBC）本期不实现，配置即报错。
 * 输出 {rows:[{col:val}], count}。受信门槛同脚本（编排编辑本身需 orch:flow:write）。
 */
public class OrchDbQueryNode extends OrchBaseNode {

    private static final int MAX_ROWS = 1000;
    /** 词边界黑名单（去字符串字面量后检查）：DML/DDL/权限/锁。 */
    private static final Pattern FORBIDDEN = Pattern.compile(
            "\\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|call|execute|copy|vacuum|comment|lock|do)\\b",
            Pattern.CASE_INSENSITIVE);

    @Override
    protected Object inputSummary(OrchRunContext ctx, JsonNode node, JsonNode config) {
        return Map.of("sql", config.path("sql").asString(""), "params", config.path("params").size());
    }

    @Override
    protected Object doExecute(OrchRunContext ctx, JsonNode node, JsonNode config) {
        if (config.hasNonNull("credentialId")) {
            throw new IllegalStateException("dbQuery 外部 JDBC 数据源（credentialId）本期未支持，仅本应用库只读");
        }
        String sql = config.path("sql").asString(null);
        validateSelectOnly(sql);

        OrchTemplate tpl = OrchSpringHolder.bean(OrchTemplate.class);
        List<Object> params = new ArrayList<>();
        for (JsonNode p : config.path("params")) {
            params.add(tpl.eval(p.asString(""), ctx.evalCtx()));
        }
        int maxRows = Math.max(1, Math.min(config.path("maxRows").asInt(MAX_ROWS), MAX_ROWS));
        int timeoutSec = (int) Math.max(1, Math.min(config.path("timeoutMs").asLong(5000) / 1000, 30));

        JdbcTemplate jdbc = new JdbcTemplate(OrchSpringHolder.bean(DataSource.class));
        jdbc.setMaxRows(maxRows);
        jdbc.setQueryTimeout(timeoutSec);
        List<Map<String, Object>> rows = jdbc.queryForList(sql, params.toArray());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", rows);
        out.put("count", rows.size());
        return out;
    }

    /** select-only 硬校验：单语句 + SELECT/WITH 开头 + 黑名单关键字（剥字符串字面量后）拒绝。 */
    private void validateSelectOnly(String sql) {
        if (!StringUtils.hasText(sql)) {
            throw new IllegalStateException("dbQuery 缺少 sql");
        }
        String stripped = sql.replaceAll("--[^\\n]*", " ")
                .replaceAll("/\\*.*?\\*/", " ")
                .trim();
        if (stripped.contains(";")) {
            throw new IllegalStateException("dbQuery 仅允许单条语句（不得含分号）");
        }
        String lower = stripped.toLowerCase();
        if (!(lower.startsWith("select") || lower.startsWith("with"))) {
            throw new IllegalStateException("dbQuery 仅允许 SELECT 查询（select-only 硬校验）");
        }
        // 剥掉字符串字面量再查黑名单，避免值里含关键字误杀
        String noLiterals = stripped.replaceAll("'([^']|'')*'", "''");
        var m = FORBIDDEN.matcher(noLiterals);
        if (m.find()) {
            throw new IllegalStateException("dbQuery 检测到禁用关键字: " + m.group());
        }
    }
}
