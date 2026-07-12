package com.xingchen.oa.office.knowledge.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.office.knowledge.dto.KbDtos.RelatedDoc;
import com.xingchen.oa.office.knowledge.dto.KbDtos.SearchHit;
import com.xingchen.oa.office.knowledge.entity.KbDoc;
import com.xingchen.oa.office.knowledge.entity.KbSpace;
import com.xingchen.oa.office.knowledge.port.KbEmbeddingPort;
import com.xingchen.oa.office.knowledge.repository.KbDocRepository;
import com.xingchen.oa.office.knowledge.repository.KbSpaceRepository;
import com.xingchen.oa.office.knowledge.support.KbAccess;
import com.xingchen.oa.office.knowledge.support.KbTextMatch;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 知识库混合检索 + 相关推荐 + RAG 检索（ai-knowledge-base.md §3/§7 批2 / §8 红线）。
 *
 * <h3>红线：严格按用户可见空间过滤</h3>
 * 一切检索/推荐/RAG 候选先经 {@link KbAccess#visibleSpaceSpec()} 收敛到当前用户可见空间——
 * 不可见空间（PRIVATE 非成员）的文档绝不进入任何结果，不为超管开后门。
 *
 * <h3>混合排序（降级默认可用）</h3>
 * <ul>
 *   <li><b>语义</b>（仅 {@link KbEmbeddingPort#available()}）：query 向量化 → kb_doc_embedding
 *       pgvector {@code <=>} 余弦最近块（按 doc 取最近块）；</li>
 *   <li><b>全文</b>（默认）：content_text 上 2-gram/整词命中计分（{@link KbTextMatch}），无嵌入凭据始终可用；</li>
 *   <li><b>混合</b>：两路归一化加权（0.6 语义 + 0.4 全文），只有全文/只有语义命中亦纳入。</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class KbSearchService {

    /** 候选装载上限（demo 规模；全文在应用层计分，避免全表无界扫描）。 */
    private static final int CANDIDATE_LIMIT = 1000;
    private static final int VECTOR_LIMIT = 50;

    private final JdbcTemplate jdbc;
    private final KbAccess access;
    private final KbSpaceRepository spaceRepository;
    private final KbDocRepository docRepository;
    private final ObjectProvider<KbEmbeddingPort> portProvider;

    // ==================== 混合检索：POST /api/kb/search ====================

    public PageResult<SearchHit> search(String q, Long spaceId, int pageNum, int pageSize) {
        int p = pageNum <= 0 ? 1 : pageNum;
        int size = pageSize <= 0 ? 10 : Math.min(pageSize, 50);
        Map<Long, String> visible = visibleSpaces();
        Set<Long> spaceIds;
        if (spaceId != null) {
            if (!visible.containsKey(spaceId)) {
                throw new BusinessException(403, "无权访问该知识空间");
            }
            spaceIds = Set.of(spaceId);
        } else {
            spaceIds = visible.keySet();
        }
        List<SearchHit> all = scoreAll(q, spaceIds, visible);
        int total = all.size();
        int from = Math.min((p - 1) * size, total);
        int to = Math.min(from + size, total);
        return new PageResult<>(new ArrayList<>(all.subList(from, to)), total, p, size);
    }

    /** RAG/工具用：当前用户可见空间内 Top-K 命中（供 boot 检索源扩展与 knowledge_* 工具）。 */
    public List<SearchHit> ragRetrieve(String q, int topK) {
        Map<Long, String> visible = visibleSpaces();
        if (visible.isEmpty()) {
            return List.of();
        }
        List<SearchHit> all = scoreAll(q, visible.keySet(), visible);
        return all.size() > topK ? new ArrayList<>(all.subList(0, topK)) : all;
    }

    // ==================== 相关推荐：GET /api/kb/docs/{id}/related ====================

    public List<RelatedDoc> related(Long docId, int topN) {
        KbDoc doc = docRepository.findById(docId)
                .orElseThrow(() -> new BusinessException(404, "文档不存在"));
        KbSpace space = spaceRepository.findById(doc.getSpaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireView(space); // 红线：无权查看该文档所在空间 → 403
        Map<Long, String> visible = visibleSpaces();
        if (visible.isEmpty()) {
            return List.of();
        }
        List<RelatedDoc> byVec = relatedByVector(docId, visible, topN);
        if (!byVec.isEmpty()) {
            return byVec;
        }
        return relatedByFulltext(docId, doc.getTitle(), visible, topN);
    }

    // ==================== 内部：混合打分 ====================

    private List<SearchHit> scoreAll(String q, Set<Long> spaceIds, Map<Long, String> nameById) {
        Set<String> terms = KbTextMatch.terms(q);
        if (spaceIds.isEmpty() || terms.isEmpty()) {
            return List.of();
        }
        List<Long> ids = new ArrayList<>(spaceIds);
        // 候选：可见空间内所有有正文的 DOC
        List<Object> params = new ArrayList<>(ids);
        List<Cand> cands = jdbc.query(
                "SELECT d.id, d.space_id, d.title, c.content_text "
                        + "FROM kb_doc d JOIN kb_doc_content c ON c.doc_id = d.id "
                        + "WHERE d.type = 'DOC' AND d.space_id IN (" + placeholders(ids.size()) + ") "
                        + "AND c.content_text IS NOT NULL AND c.content_text <> '' LIMIT " + CANDIDATE_LIMIT,
                (rs, n) -> new Cand(rs.getLong("id"), rs.getLong("space_id"),
                        rs.getString("title"), rs.getString("content_text")),
                params.toArray());
        if (cands.isEmpty()) {
            return List.of();
        }
        // 全文计分
        int ftMax = 1;
        Map<Long, Integer> ftScore = new LinkedHashMap<>();
        for (Cand c : cands) {
            int s = KbTextMatch.score(c.title(), c.text(), terms);
            ftScore.put(c.docId(), s);
            ftMax = Math.max(ftMax, s);
        }
        // 语义（有嵌入凭据）
        Map<Long, Double> vecScore = vectorScores(q, ids);

        List<SearchHit> hits = new ArrayList<>();
        for (Cand c : cands) {
            int ft = ftScore.getOrDefault(c.docId(), 0);
            Double vs = vecScore.get(c.docId());
            double score;
            String matchedBy;
            if (vs != null && ft > 0) {
                score = 0.6 * vs + 0.4 * ((double) ft / ftMax);
                matchedBy = "hybrid";
            } else if (vs != null) {
                score = 0.6 * vs;
                matchedBy = "vector";
            } else if (ft > 0) {
                score = (double) ft / ftMax;
                matchedBy = "fulltext";
            } else {
                continue; // 无任何命中
            }
            hits.add(new SearchHit(c.docId(), c.title(), c.spaceId(), nameById.get(c.spaceId()),
                    KbTextMatch.snippet(c.text(), terms), round(score), matchedBy));
        }
        hits.sort((a, b) -> {
            int cmp = Double.compare(b.score(), a.score());
            return cmp != 0 ? cmp : Long.compare(a.docId(), b.docId());
        });
        return hits;
    }

    /** 语义近邻：doc → 其最近块的余弦相似（1 - 距离）。无凭据/失败 → 空 map（纯全文）。 */
    private Map<Long, Double> vectorScores(String q, List<Long> spaceIds) {
        KbEmbeddingPort port = portProvider.getIfAvailable();
        if (port == null || !port.available()) {
            return Map.of();
        }
        try {
            float[] vec = port.embed(q);
            if (vec == null) {
                return Map.of();
            }
            List<Object> params = new ArrayList<>();
            params.add(KbTextMatch.toVectorLiteral(vec));
            params.addAll(spaceIds);
            Map<Long, Double> out = new LinkedHashMap<>();
            jdbc.query(
                    "SELECT e.doc_id, MIN(e.embedding <=> CAST(? AS vector)) AS dist "
                            + "FROM kb_doc_embedding e JOIN kb_doc d ON d.id = e.doc_id "
                            + "WHERE e.embedding IS NOT NULL AND d.space_id IN (" + placeholders(spaceIds.size()) + ") "
                            + "GROUP BY e.doc_id ORDER BY dist ASC LIMIT " + VECTOR_LIMIT,
                    rs -> { out.put(rs.getLong("doc_id"), 1.0 - rs.getDouble("dist")); },
                    params.toArray());
            return out;
        } catch (Exception e) {
            log.debug("知识库语义检索失败（降级全文）: {}", e.getMessage());
            return Map.of();
        }
    }

    private List<RelatedDoc> relatedByVector(Long docId, Map<Long, String> nameById, int topN) {
        KbEmbeddingPort port = portProvider.getIfAvailable();
        if (port == null || !port.available()) {
            return List.of();
        }
        try {
            List<Long> ids = new ArrayList<>(nameById.keySet());
            List<Object> params = new ArrayList<>();
            params.add(docId); // e2.doc_id <> ?
            params.add(docId); // e1.doc_id = ?
            params.addAll(ids);
            List<RelatedDoc> out = new ArrayList<>();
            jdbc.query(
                    "SELECT e2.doc_id, d2.title, d2.space_id, MIN(e1.embedding <=> e2.embedding) AS dist "
                            + "FROM kb_doc_embedding e1 "
                            + "JOIN kb_doc_embedding e2 ON e2.embedding IS NOT NULL AND e2.doc_id <> ? "
                            + "JOIN kb_doc d2 ON d2.id = e2.doc_id "
                            + "WHERE e1.doc_id = ? AND e1.embedding IS NOT NULL "
                            + "AND d2.space_id IN (" + placeholders(ids.size()) + ") "
                            + "GROUP BY e2.doc_id, d2.title, d2.space_id ORDER BY dist ASC LIMIT " + topN,
                    rs -> {
                        long sid = rs.getLong("space_id");
                        out.add(new RelatedDoc(rs.getLong("doc_id"), rs.getString("title"),
                                sid, nameById.get(sid), round(1.0 - rs.getDouble("dist"))));
                    },
                    params.toArray());
            return out;
        } catch (Exception e) {
            log.debug("知识库相关推荐(语义)失败（降级全文）: {}", e.getMessage());
            return List.of();
        }
    }

    private List<RelatedDoc> relatedByFulltext(Long docId, String title, Map<Long, String> nameById, int topN) {
        List<Long> ids = new ArrayList<>(nameById.keySet());
        List<String> texts = jdbc.query("SELECT content_text FROM kb_doc_content WHERE doc_id = ?",
                (rs, n) -> rs.getString(1), docId);
        String target = texts.isEmpty() ? null : texts.get(0);
        if (target != null && target.length() > 600) {
            target = target.substring(0, 600);
        }
        Set<String> terms = KbTextMatch.terms((title == null ? "" : title) + " " + (target == null ? "" : target));
        if (terms.isEmpty()) {
            return List.of();
        }
        List<Object> params = new ArrayList<>();
        params.add(docId);
        params.addAll(ids);
        List<Cand> cands = jdbc.query(
                "SELECT d.id, d.space_id, d.title, c.content_text "
                        + "FROM kb_doc d JOIN kb_doc_content c ON c.doc_id = d.id "
                        + "WHERE d.type = 'DOC' AND d.id <> ? AND d.space_id IN (" + placeholders(ids.size()) + ") "
                        + "AND c.content_text IS NOT NULL AND c.content_text <> '' LIMIT " + CANDIDATE_LIMIT,
                (rs, n) -> new Cand(rs.getLong("id"), rs.getLong("space_id"),
                        rs.getString("title"), rs.getString("content_text")),
                params.toArray());
        List<RelatedDoc> out = new ArrayList<>();
        for (Cand c : cands) {
            int s = KbTextMatch.score(c.title(), c.text(), terms);
            if (s > 0) {
                out.add(new RelatedDoc(c.docId(), c.title(), c.spaceId(), nameById.get(c.spaceId()), s));
            }
        }
        out.sort((a, b) -> Double.compare(b.score(), a.score()));
        return out.size() > topN ? out.subList(0, topN) : out;
    }

    // ==================== 辅助 ====================

    /** 当前用户可见空间 id → name（红线过滤的唯一来源）。 */
    private Map<Long, String> visibleSpaces() {
        Map<Long, String> map = new LinkedHashMap<>();
        for (KbSpace s : spaceRepository.findAll(access.visibleSpaceSpec())) {
            map.put(s.getId(), s.getName());
        }
        return map;
    }

    private static String placeholders(int n) {
        return String.join(",", java.util.Collections.nCopies(Math.max(n, 1), "?"));
    }

    private static double round(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }

    private record Cand(Long docId, Long spaceId, String title, String text) {
    }
}
