package com.xingchen.oa.boot.ai.kb;

import com.xingchen.oa.boot.ai.service.AiEmbeddingService;
import com.xingchen.oa.office.knowledge.port.KbEmbeddingPort;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 知识库嵌入端口的 boot 侧实现（ai-knowledge-base.md §3/§8 模块边界）。
 *
 * <p>office 的 {@link KbEmbeddingPort} 由此适配到批D 的 {@link AiEmbeddingService}
 * （OpenAI 兼容 /embeddings，DeepSeek 无 → available()=false → 全文降级）。方向 boot → office（实现其接口），
 * 不反向依赖：office 编译期不知道 AiEmbeddingService 的存在。</p>
 */
@Component
@RequiredArgsConstructor
public class KbEmbeddingAdapter implements KbEmbeddingPort {

    private final AiEmbeddingService embeddingService;

    @Override
    public boolean available() {
        return embeddingService.available();
    }

    @Override
    public float[] embed(String text) {
        return embeddingService.embed(text);
    }
}
