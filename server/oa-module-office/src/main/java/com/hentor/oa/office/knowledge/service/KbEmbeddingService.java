package com.hentor.oa.office.knowledge.service;

import com.hentor.oa.office.knowledge.port.KbEmbeddingPort;
import com.hentor.oa.office.knowledge.support.KbChunker;
import com.hentor.oa.office.knowledge.support.KbTextMatch;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;

/**
 * 知识库分块嵌入写入（ai-knowledge-base.md §3/§7 批2）。
 *
 * <p><b>触发</b>：文档保存正文（PUT /docs/{id}/content）后由 {@code KbDocService} 在事务提交后调用
 * {@link #reindex}——先删旧块再按 content_text 分块重建：有嵌入凭据（{@link KbEmbeddingPort#available()}）
 * 逐块写 embedding，无则 embedding 留 NULL（全文降级标记）。vector 列不走 JPA，一律 JdbcTemplate 原生 SQL
 * （CAST(? AS vector)），与批D {@code ai_knowledge_doc} 同款。</p>
 *
 * <p><b>降级红线</b>：无凭据/嵌入失败绝不阻断保存——分块行仍写入（chunk_text 可全文检索），只是 embedding 空。
 * 删除文档/空间时 {@link #deleteByDocIds} 级联清理。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class KbEmbeddingService {

    private final JdbcTemplate jdbc;
    private final KbChunker chunker;
    private final ObjectProvider<KbEmbeddingPort> portProvider;

    /**
     * 重建某文档的分块向量：删旧块 → 分块 → 逐块写入（有凭据带 embedding，无则 NULL）。
     * 任何异常不外抛（保存正文已提交，嵌入是增强不是主流程）。
     */
    public void reindex(Long docId, String contentText) {
        try {
            jdbc.update("DELETE FROM kb_doc_embedding WHERE doc_id = ?", docId);
            if (!StringUtils.hasText(contentText)) {
                return;
            }
            List<String> chunks = chunker.chunk(contentText);
            KbEmbeddingPort port = portProvider.getIfAvailable();
            boolean vector = port != null && port.available();
            OffsetDateTime now = OffsetDateTime.now();
            for (int i = 0; i < chunks.size(); i++) {
                String chunk = chunks.get(i);
                float[] emb = vector ? safeEmbed(port, chunk) : null;
                if (emb != null) {
                    jdbc.update("INSERT INTO kb_doc_embedding (doc_id, chunk_seq, chunk_text, embedding, updated_at) "
                                    + "VALUES (?, ?, ?, CAST(? AS vector), ?)",
                            docId, i, chunk, KbTextMatch.toVectorLiteral(emb), now);
                } else {
                    jdbc.update("INSERT INTO kb_doc_embedding (doc_id, chunk_seq, chunk_text, embedding, updated_at) "
                                    + "VALUES (?, ?, ?, NULL, ?)",
                            docId, i, chunk, now);
                }
            }
            log.debug("知识库文档 {} 重建分块 {} 块（vector={}）", docId, chunks.size(), vector);
        } catch (Exception e) {
            log.warn("知识库文档 {} 分块嵌入重建失败（不影响正文保存）: {}", docId, e.getMessage());
        }
    }

    /** 级联删除文档的分块向量（删文档/删空间时调用）。 */
    public void deleteByDocIds(Collection<Long> docIds) {
        if (docIds == null || docIds.isEmpty()) {
            return;
        }
        String placeholders = String.join(",", docIds.stream().map(id -> "?").toList());
        jdbc.update("DELETE FROM kb_doc_embedding WHERE doc_id IN (" + placeholders + ")", docIds.toArray());
    }

    private float[] safeEmbed(KbEmbeddingPort port, String text) {
        try {
            return port.embed(text);
        } catch (Exception e) {
            log.debug("分块嵌入失败（降级全文）: {}", e.getMessage());
            return null;
        }
    }
}
