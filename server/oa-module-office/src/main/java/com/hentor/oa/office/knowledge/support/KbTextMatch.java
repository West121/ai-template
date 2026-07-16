package com.hentor.oa.office.knowledge.support;

import org.springframework.util.StringUtils;

import java.util.LinkedHashSet;
import java.util.Set;

/**
 * 知识库全文匹配打分与片段高亮（ai-knowledge-base.md §3 混合检索的全文降级分支）。
 *
 * <p>中文无分词：查询词 = 整词（按标点/空白切）+ 2-gram（simple 分词退化兜底），与批D {@code AiRagService}
 * 同口径，保证「无嵌入凭据默认全文可用」。命中计分：标题命中权重更高；片段以首个命中词为中心开窗并 {@code <mark>} 高亮。</p>
 */
public final class KbTextMatch {

    private static final int SNIPPET_WINDOW = 60; // 命中词前后各取的字符数
    private static final String STOP = "怎样什么如何是的了吗呢啊这那我你他";

    private KbTextMatch() {
    }

    /** 查询词集合：整词 + 2-gram（去高频虚词 2-gram 噪声）。 */
    public static Set<String> terms(String query) {
        Set<String> out = new LinkedHashSet<>();
        if (!StringUtils.hasText(query)) {
            return out;
        }
        String q = query.toLowerCase().trim();
        for (String w : q.split("[\\s,，。？?！!、:：;；()（）\\[\\]{}\"'“”]+")) {
            if (w.length() >= 2) {
                out.add(w);
            }
        }
        String compact = q.replaceAll("[\\s\\p{Punct}，。？！、：；（）]+", "");
        for (int i = 0; i + 2 <= compact.length(); i++) {
            out.add(compact.substring(i, i + 2));
        }
        out.removeIf(t -> t.length() == 2
                && STOP.contains(t.substring(0, 1)) && STOP.contains(t.substring(1)));
        return out;
    }

    /** 命中计分：标题命中 +3、正文命中 +1（每个不同查询词计一次）。 */
    public static int score(String title, String text, Set<String> terms) {
        String t = title == null ? "" : title.toLowerCase();
        String c = text == null ? "" : text.toLowerCase();
        int score = 0;
        for (String term : terms) {
            boolean inTitle = t.contains(term);
            boolean inBody = c.contains(term);
            if (inTitle) {
                score += 3;
            } else if (inBody) {
                score += 1;
            }
        }
        return score;
    }

    /**
     * 高亮片段：以首个命中词为中心开窗，命中的最长查询词用 {@code <mark>} 包裹。无命中→截断开头。
     */
    public static String snippet(String text, Set<String> terms) {
        if (!StringUtils.hasText(text)) {
            return "";
        }
        String lower = text.toLowerCase();
        int hit = -1;
        String hitTerm = null;
        for (String term : terms) {
            int idx = lower.indexOf(term);
            if (idx >= 0 && (hit < 0 || idx < hit || (idx == hit && term.length() > hitTerm.length()))) {
                hit = idx;
                hitTerm = term;
            }
        }
        if (hit < 0) {
            return text.length() > SNIPPET_WINDOW * 2 ? text.substring(0, SNIPPET_WINDOW * 2) + "…" : text;
        }
        int start = Math.max(0, hit - SNIPPET_WINDOW);
        int end = Math.min(text.length(), hit + hitTerm.length() + SNIPPET_WINDOW);
        // 该窗口内出现的最长命中词做高亮（一次，避免 2-gram 嵌套标记）
        String longest = null;
        for (String term : terms) {
            if (lower.indexOf(term, start) >= 0 && lower.indexOf(term, start) < end
                    && (longest == null || term.length() > longest.length())) {
                longest = term;
            }
        }
        String window = text.substring(start, end);
        if (longest != null) {
            int rel = window.toLowerCase().indexOf(longest);
            if (rel >= 0) {
                window = window.substring(0, rel) + "<mark>" + window.substring(rel, rel + longest.length())
                        + "</mark>" + window.substring(rel + longest.length());
            }
        }
        return (start > 0 ? "…" : "") + window + (end < text.length() ? "…" : "");
    }

    /** pgvector 字面量：'[0.1,0.2,...]'（与批D AiEmbeddingService.toVectorLiteral 同格式）。 */
    public static String toVectorLiteral(float[] vec) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < vec.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(vec[i]);
        }
        return sb.append(']').toString();
    }
}
