package com.xingchen.oa.office.knowledge.port;

/**
 * 嵌入能力端口（ai-knowledge-base.md §3/§8：模块边界——office 知识库子包定义接口，boot ai 侧实现，不反向依赖）。
 *
 * <p>office 模块不可依赖 oa-boot（AiEmbeddingService 在 boot），故以依赖倒置：本接口在 office 声明，
 * boot 的 {@code KbEmbeddingAdapter} 实现并委托 {@code AiEmbeddingService}（OpenAI 兼容 /embeddings，
 * DeepSeek 无 → 全文降级）。运行时 Spring 注入；无实现（如切片测试）→ {@code available()} 视为 false。</p>
 */
public interface KbEmbeddingPort {

    /** 是否具备可用嵌入凭据（否 → 检索/推荐一律走全文/ILIKE 降级，默认路径）。 */
    boolean available();

    /** 文本 → 向量；未启用/无凭据/任何失败一律返回 null（静默降级）。 */
    float[] embed(String text);
}
