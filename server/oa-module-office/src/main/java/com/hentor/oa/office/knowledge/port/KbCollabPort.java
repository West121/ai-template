package com.hentor.oa.office.knowledge.port;

/**
 * 知识库实时协同（CRDT）端口（ai-knowledge-base.md §4 批4b · §8 模块边界）。
 *
 * <p>WebSocket 端点在 boot（{@code com.hentor.oa.boot.kb.collab}），协同握手鉴权与 ydoc 持久化
 * 需要读写 office 的知识库领域对象；boot → office 为允许方向，故由 office 暴露此端口，boot 正向调用，
 * <b>不反向依赖</b>。</p>
 *
 * <ul>
 *   <li>{@link #assertDocEditable(Long)}：握手闸口——当前线程 {@code CurrentUserHolder} 已装配用户上下文，
 *       校验其对该文档所在空间 EDITOR/ADMIN；无权抛 {@code BusinessException}（403/404），boot 据此拒绝握手（前端降级单人）。</li>
 *   <li>{@link #loadYdoc(Long)} / {@link #saveYdoc(Long, byte[])}：ydoc 二进制状态的读写——
 *       后端纯 relay 不解析 CRDT，仅把在线客户端汇聚的完整状态快照落 {@code kb_doc_content.ydoc}，
 *       新会话连入时回放给它（即使无其他在线客户端也能拿到已有内容）。</li>
 * </ul>
 */
public interface KbCollabPort {

    /**
     * 校验当前登录用户（{@code CurrentUserHolder}）对该文档所在空间可编辑（EDITOR/ADMIN）。
     * 文档不存在 → 404；无编辑权 → 403；未登录 → 401。均以 {@code BusinessException} 抛出。
     */
    void assertDocEditable(Long docId);

    /**
     * 读取文档持久化的 ydoc 二进制状态（协同快照）。无正文行或从未协同过 → 返回 {@code null}。
     * <b>系统级读，不做用户权限校验</b>（权限已在握手 assertDocEditable 校验）。
     */
    byte[] loadYdoc(Long docId);

    /**
     * 落库文档 ydoc 二进制状态（房间清空/定期快照时由 boot 调用）。正文行不存在则 upsert 建行；
     * 只更新 ydoc 列，不动 content_json/content_text（REST 保存路径互不影响）。文档已删则静默 no-op。
     */
    void saveYdoc(Long docId, byte[] ydoc);
}
