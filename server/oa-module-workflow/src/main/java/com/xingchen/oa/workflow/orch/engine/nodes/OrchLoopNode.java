package com.xingchen.oa.workflow.orch.engine.nodes;

import com.xingchen.oa.workflow.orch.engine.OrchNodeLogger;
import com.xingchen.oa.workflow.orch.engine.OrchRunContext;
import com.xingchen.oa.workflow.orch.engine.OrchSpringHolder;
import com.xingchen.oa.workflow.orch.engine.OrchTemplate;
import com.xingchen.oa.workflow.orch.entity.OrchExecNode;
import com.yomahub.liteflow.core.NodeIteratorComponent;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * loop 节点（LiteFlow ITERATOR）：config {collection(Aviator 表达式,如 outputs.n1.body.list),
 * itemVar(默认 item), maxIterations(护栏,默认/上限 1000)}。每次迭代把当前项写入 vars[itemVar]
 * （附带 vars[itemVar+"Index"]），循环体（DO 子链）经模板/表达式引用。
 */
public class OrchLoopNode extends NodeIteratorComponent {

    private static final int MAX_ITERATIONS = 1000;

    @Override
    public Iterator<?> processIterator() throws Exception {
        OrchRunContext ctx = this.getContextBean(OrchRunContext.class);
        String nodeId = this.getTag();
        JsonNode node = ctx.node(nodeId);
        JsonNode config = node.path("config");
        OrchNodeLogger logger = OrchSpringHolder.bean(OrchNodeLogger.class);
        OrchExecNode row = logger.start(ctx.execId, nodeId, node.path("name").asString(nodeId),
                Map.of("collection", config.path("collection").asString("")));
        long start = System.currentTimeMillis();
        try {
            String collectionExpr = config.path("collection").asString(null);
            if (!StringUtils.hasText(collectionExpr)) {
                throw new IllegalStateException("loop 节点缺少 collection 表达式");
            }
            Object value = OrchSpringHolder.bean(OrchTemplate.class).eval(collectionExpr, ctx.evalCtx());
            List<Object> items = new ArrayList<>();
            if (value instanceof Iterable<?> it) {
                it.forEach(items::add);
            } else if (value instanceof Object[] arr) {
                items.addAll(List.of(arr));
            } else if (value != null) {
                throw new IllegalStateException("loop collection 须为集合，实际: " + value.getClass().getSimpleName());
            }
            int max = Math.max(1, Math.min(config.path("maxIterations").asInt(MAX_ITERATIONS), MAX_ITERATIONS));
            if (items.size() > max) {
                items = items.subList(0, max);
            }
            String itemVar = config.path("itemVar").asString("item");
            logger.finish(row, true, Map.of("size", items.size()), null, 1, System.currentTimeMillis() - start);

            Iterator<Object> inner = items.iterator();
            int[] idx = {0};
            // 包装迭代器：next() 时把当前项/序号写入 vars，循环体据 {{vars.<itemVar>}} 引用
            return new Iterator<>() {
                @Override
                public boolean hasNext() {
                    return inner.hasNext();
                }

                @Override
                public Object next() {
                    Object item = inner.next();
                    ctx.vars.put(itemVar, item);
                    ctx.vars.put(itemVar + "Index", idx[0]++);
                    return item;
                }
            };
        } catch (Exception e) {
            logger.finish(row, false, null, e.getMessage(), 1, System.currentTimeMillis() - start);
            throw e;
        }
    }
}
