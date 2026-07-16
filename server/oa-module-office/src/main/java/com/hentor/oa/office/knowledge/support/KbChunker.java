package com.hentor.oa.office.knowledge.support;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;

/**
 * 正文分块（ai-knowledge-base.md §3/§7 批2：content_text → 段落/定长块）。
 *
 * <p>按段落（换行）切分后贪心合并到不超过 {@link #MAX_CHARS} 的块；超长段落按定长硬切。
 * 供 {@code KbEmbeddingService} 逐块嵌入（有凭据）或留空（无凭据全文标记）。中文按字符计长。</p>
 */
@Component
public class KbChunker {

    private static final int MAX_CHARS = 500;

    public List<String> chunk(String text) {
        List<String> chunks = new ArrayList<>();
        if (!StringUtils.hasText(text)) {
            return chunks;
        }
        StringBuilder cur = new StringBuilder();
        for (String para : text.split("\\r?\\n+")) {
            String p = para.trim();
            if (p.isEmpty()) {
                continue;
            }
            // 超长段落先硬切成多个 MAX_CHARS 块
            while (p.length() > MAX_CHARS) {
                flush(chunks, cur);
                chunks.add(p.substring(0, MAX_CHARS));
                p = p.substring(MAX_CHARS);
            }
            if (cur.length() + p.length() + 1 > MAX_CHARS) {
                flush(chunks, cur);
            }
            if (cur.length() > 0) {
                cur.append('\n');
            }
            cur.append(p);
        }
        flush(chunks, cur);
        return chunks;
    }

    private void flush(List<String> chunks, StringBuilder cur) {
        if (cur.length() > 0) {
            chunks.add(cur.toString());
            cur.setLength(0);
        }
    }
}
