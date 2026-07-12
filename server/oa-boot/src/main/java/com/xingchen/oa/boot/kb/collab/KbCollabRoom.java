package com.xingchen.oa.boot.kb.collab;

import org.springframework.web.socket.WebSocketSession;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 一个文档的协同房间（内存态，ai-knowledge-base.md §4 批4b）。
 *
 * <p>后端不解析 CRDT：房间只保存「内容更新消息帧」的有序列表 {@code updateLog}
 * （初始来自 DB 的 ydoc 快照解帧，之后追加在线客户端发来的 sync/step2、sync/update）。
 * 新会话连入时把 {@code updateLog} 逐帧回放给它——Yjs update 幂等可交换，回放即合并，
 * 即便无其他在线客户端也能拿到已有内容。房间清空时把 {@code updateLog} 分帧落库。</p>
 *
 * <p>所有字段的读写都由 {@link KbCollabHandler} 在 {@code synchronized(room)} 下进行，
 * 保证同一会话不会被并发 send（{@code WebSocketSession#sendMessage} 非线程安全）。</p>
 */
final class KbCollabRoom {

    /** 单帧上限（超大更新丢弃不持久化，避免异常客户端撑爆内存）。 */
    static final int MAX_FRAME_BYTES = 4 * 1024 * 1024;
    /** 触发「拉全量压实」的帧数阈值。 */
    static final int COMPACT_FRAME_THRESHOLD = 400;
    /** 触发「拉全量压实」的累计字节阈值。 */
    static final int COMPACT_BYTES_THRESHOLD = 1024 * 1024;

    final Long docId;
    final Set<WebSocketSession> sessions = new LinkedHashSet<>();
    /** 有序内容更新帧（DB 快照 + 在线增量），回放/落库均按此。 */
    final List<byte[]> updateLog = new ArrayList<>();
    long logBytes;
    boolean dirty;
    /** 正在向其「拉全量以压实」的目标会话；null 表示未在拉取。 */
    WebSocketSession pullTarget;

    KbCollabRoom(Long docId, List<byte[]> initialLog) {
        this.docId = docId;
        if (initialLog != null) {
            for (byte[] m : initialLog) {
                updateLog.add(m);
                logBytes += m.length;
            }
        }
    }

    int sessionCount() {
        return sessions.size();
    }

    void appendUpdate(byte[] message) {
        updateLog.add(message);
        logBytes += message.length;
        dirty = true;
    }

    /** 用单帧全量状态替换整段日志（压实）。 */
    void replaceWithFullState(byte[] fullStateMessage) {
        updateLog.clear();
        updateLog.add(fullStateMessage);
        logBytes = fullStateMessage.length;
        dirty = true;
    }

    boolean needsCompaction() {
        return updateLog.size() > COMPACT_FRAME_THRESHOLD || logBytes > COMPACT_BYTES_THRESHOLD;
    }

    List<byte[]> snapshotFrames() {
        return new ArrayList<>(updateLog);
    }
}
