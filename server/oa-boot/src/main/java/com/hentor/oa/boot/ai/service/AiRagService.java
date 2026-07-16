package com.hentor.oa.boot.ai.service;

import com.hentor.oa.boot.ai.entity.AiKnowledgeDoc;
import com.hentor.oa.boot.ai.repository.AiKnowledgeDocRepository;
import com.hentor.oa.common.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * RAG 检索服务（ai-assistant-design-v2.md §12.2，批D）。
 *
 * <h3>检索策略（降级默认可用）</h3>
 * <ol>
 *   <li><b>向量</b>（仅当 {@link AiEmbeddingService#available()}）：query 向量化 → pgvector {@code <=>} 余弦距离
 *       近邻（JdbcTemplate 原生，仅命中已写入 embedding 的行）；</li>
 *   <li><b>全文/ILIKE 降级</b>（默认）：DeepSeek 无 /embeddings——按 2-gram（中文无分词，simple 分词退化）+
 *       整词在 title/content 的命中数打分排序，纯 Java 计分，无 PG FTS 配置依赖，<b>始终可用</b>。</li>
 * </ol>
 * 命中内容由 {@code RetrievalAugmentationAdvisor} 以「参考资料」包裹注入 system（不作系统指令，§12.2），
 * 并产出 {@code RAG_DOC} 引用（sourceId=docId,title）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiRagService {

    private static final int DEFAULT_TOP_K = 3;
    private static final int SNIPPET_LEN = 400;

    private final AiKnowledgeDocRepository repository;
    private final AiEmbeddingService embeddingService;
    private final JdbcTemplate jdbcTemplate;

    /** 检索命中（snippet=注入用截断内容）。 */
    public record Hit(Long docId, String title, String snippet, double score, String matchedBy) {
    }

    /** 默认 topK 检索（moduleCode 可空=全模块）。 */
    public List<Hit> retrieve(String query, String moduleCode) {
        return retrieve(query, moduleCode, DEFAULT_TOP_K);
    }

    public List<Hit> retrieve(String query, String moduleCode, int topK) {
        if (!StringUtils.hasText(query)) {
            return List.of();
        }
        // ① 向量路径（有嵌入凭据且启用）
        if (embeddingService.available()) {
            List<Hit> byVec = retrieveByVector(query, moduleCode, topK);
            if (!byVec.isEmpty()) {
                return byVec;
            }
        }
        // ② 全文/ILIKE 降级（默认路径，必可用）
        return retrieveByKeyword(query, moduleCode, topK);
    }

    // ==================== ① 向量近邻（pgvector <=>） ====================

    private List<Hit> retrieveByVector(String query, String moduleCode, int topK) {
        try {
            float[] vec = embeddingService.embed(query);
            if (vec == null) {
                return List.of();
            }
            String literal = AiEmbeddingService.toVectorLiteral(vec);
            StringBuilder sql = new StringBuilder(
                    "SELECT id, title, content, (embedding <=> CAST(? AS vector)) AS dist "
                    + "FROM ai_knowledge_doc WHERE status = 'PUBLISHED' AND embedding IS NOT NULL");
            List<Object> params = new ArrayList<>();
            params.add(literal);
            if (StringUtils.hasText(moduleCode)) {
                sql.append(" AND module_code = ?");
                params.add(moduleCode);
            }
            sql.append(" ORDER BY dist ASC LIMIT ?");
            params.add(topK);
            List<Hit> hits = new ArrayList<>();
            jdbcTemplate.query(sql.toString(), rs -> {
                double dist = rs.getDouble("dist");
                hits.add(new Hit(rs.getLong("id"), rs.getString("title"),
                        snippet(rs.getString("content")), 1.0 - dist, "vector"));
            }, params.toArray());
            return hits;
        } catch (Exception e) {
            log.debug("向量检索失败，降级全文: {}", e.getMessage());
            return List.of();
        }
    }

    // ==================== ② 全文/ILIKE 降级（2-gram 计分） ====================

    private List<Hit> retrieveByKeyword(String query, String moduleCode, int topK) {
        Set<String> terms = terms(query);
        if (terms.isEmpty()) {
            return List.of();
        }
        List<AiKnowledgeDoc> docs = StringUtils.hasText(moduleCode)
                ? repository.findByStatusAndModuleCodeOrderByIdAsc(AiKnowledgeDoc.STATUS_PUBLISHED, moduleCode)
                : repository.findByStatusOrderByIdAsc(AiKnowledgeDoc.STATUS_PUBLISHED);
        List<Hit> scored = new ArrayList<>();
        for (AiKnowledgeDoc d : docs) {
            String hay = ((d.getTitle() == null ? "" : d.getTitle()) + " "
                    + (d.getContent() == null ? "" : d.getContent())).toLowerCase();
            int score = 0;
            for (String t : terms) {
                if (hay.contains(t)) {
                    // 标题命中权重更高
                    score += (d.getTitle() != null && d.getTitle().toLowerCase().contains(t)) ? 3 : 1;
                }
            }
            if (score > 0) {
                scored.add(new Hit(d.getId(), d.getTitle(), snippet(d.getContent()), score, "fulltext"));
            }
        }
        scored.sort((a, b) -> Double.compare(b.score(), a.score()));
        return scored.size() > topK ? scored.subList(0, topK) : scored;
    }

    /** 查询词：整词（按非中日韩分隔）+ 2-gram（中文 simple 分词退化的兜底）。 */
    private Set<String> terms(String query) {
        Set<String> out = new LinkedHashSet<>();
        String q = query.toLowerCase().trim();
        for (String w : q.split("[\\s,，。？?！!、:：;；()（）\"'“”]+")) {
            if (w.length() >= 2) {
                out.add(w);
            }
        }
        String compact = q.replaceAll("[\\s\\p{Punct}，。？！、：；（）]+", "");
        for (int i = 0; i + 2 <= compact.length(); i++) {
            out.add(compact.substring(i, i + 2));
        }
        // 去停用 2-gram（常见虚词组合命中率过高，噪声）
        out.removeIf(t -> t.length() == 2 && "怎样什么如何是的了吗呢啊这那我你他".contains(t.substring(0, 1))
                && "怎样什么如何是的了吗呢啊这那我你他".contains(t.substring(1)));
        return out;
    }

    private String snippet(String content) {
        if (content == null) {
            return "";
        }
        return content.length() > SNIPPET_LEN ? content.substring(0, SNIPPET_LEN) + "…" : content;
    }

    // ==================== 知识文档管理（admin，无 UI 亦可） ====================

    public List<Map<String, Object>> listDocs() {
        return repository.findAll().stream().map(this::view).toList();
    }

    public Map<String, Object> createDoc(String title, String moduleCode, String content) {
        if (!StringUtils.hasText(title) || !StringUtils.hasText(content)) {
            throw new BusinessException(400, "title/content 不能为空");
        }
        AiKnowledgeDoc d = new AiKnowledgeDoc();
        d.setTitle(title.trim());
        d.setModuleCode(StringUtils.hasText(moduleCode) ? moduleCode.trim() : null);
        d.setContent(content);
        d.setStatus(AiKnowledgeDoc.STATUS_PUBLISHED);
        d = repository.save(d);
        maybeWriteEmbedding(d);
        return view(d);
    }

    public void deleteDoc(Long id) {
        if (!repository.existsById(id)) {
            throw new BusinessException(404, "知识文档不存在");
        }
        repository.deleteById(id);
    }

    /** 有嵌入凭据时，写文档后计算并回填 embedding（原生 UPDATE，vector 列不走 JPA）。 */
    private void maybeWriteEmbedding(AiKnowledgeDoc d) {
        if (!embeddingService.available()) {
            return;
        }
        try {
            float[] vec = embeddingService.embed(d.getTitle() + "\n" + d.getContent());
            if (vec != null) {
                jdbcTemplate.update("UPDATE ai_knowledge_doc SET embedding = CAST(? AS vector), updated_at = ? WHERE id = ?",
                        AiEmbeddingService.toVectorLiteral(vec), OffsetDateTime.now(), d.getId());
            }
        } catch (Exception e) {
            log.warn("知识文档 embedding 回填失败 id={}: {}", d.getId(), e.getMessage());
        }
    }

    private Map<String, Object> view(AiKnowledgeDoc d) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("id", d.getId());
        o.put("title", d.getTitle());
        o.put("moduleCode", d.getModuleCode());
        o.put("content", d.getContent());
        o.put("status", d.getStatus());
        o.put("version", d.getVersion());
        return o;
    }
}
