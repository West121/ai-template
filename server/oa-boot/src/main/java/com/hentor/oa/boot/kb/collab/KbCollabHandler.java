package com.hentor.oa.boot.kb.collab;

import com.hentor.oa.office.knowledge.port.KbCollabPort;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 知识库实时协同 WebSocket 处理器（ai-knowledge-base.md §4 批4b · 方案A：Spring 承载 Yjs）。
 *
 * <p><b>纯 relay（后端不解析 Yjs CRDT）</b>：一个会话发来的二进制消息（y-sync / y-awareness）广播给同房间其它会话。
 * 持久化用「内容更新帧日志」快照——新会话连入回放已存内容（即便无其他在线客户端），房间清空/定期落
 * {@code kb_doc_content.ydoc}；日志过大时向唯一在线客户端拉全量压实（不需 Java 解析 CRDT）。</p>
 *
 * <p>降级：本处理器只承载协同，不触碰 REST 保存正文（PUT /content）——WebSocket 连不上时前端退单人编辑锁，
 * REST 保存照常可用、互不影响。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class KbCollabHandler extends AbstractWebSocketHandler {

    /** 单会话入站二进制消息上限（与容器 maxBinaryMessageBufferSize 对齐）。 */
    private static final int SESSION_BINARY_LIMIT = 4 * 1024 * 1024;
    /** 定期落库间隔（长时间编辑期间的持久化保障，非仅靠房间清空）。 */
    private static final long FLUSH_INTERVAL_SEC = 15;

    private final KbCollabPort kbCollabPort;

    private final ConcurrentHashMap<Long, KbCollabRoom> rooms = new ConcurrentHashMap<>();
    private ScheduledExecutorService flusher;

    @PostConstruct
    void startFlusher() {
        flusher = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "kb-collab-flush");
            t.setDaemon(true);
            return t;
        });
        flusher.scheduleWithFixedDelay(this::flushDirtyRooms, FLUSH_INTERVAL_SEC, FLUSH_INTERVAL_SEC, TimeUnit.SECONDS);
    }

    @PreDestroy
    void stopFlusher() {
        if (flusher != null) {
            flusher.shutdownNow();
        }
        // 关停前把脏房间落库，避免优雅停机丢最后编辑
        rooms.values().forEach(this::persist);
    }

    // ---------------------------------------------------------------------
    // 连接生命周期
    // ---------------------------------------------------------------------

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        session.setBinaryMessageSizeLimit(SESSION_BINARY_LIMIT);
        Long docId = docId(session);
        if (docId == null) {
            closeQuietly(session, CloseStatus.NOT_ACCEPTABLE);
            return;
        }
        // 房间不存在时从 DB 冷载 ydoc 快照解帧（在 map 计算外做阻塞 IO）
        List<byte[]> initial = rooms.containsKey(docId)
                ? null
                : YProtocol.unframe(safeLoadYdoc(docId));
        // 原子地 get-or-create 并加入会话（与关闭时的移除互斥，杜绝「最后一人离开」竞态孤儿房间）
        KbCollabRoom room = rooms.compute(docId, (id, cur) -> {
            KbCollabRoom r = (cur != null) ? cur : new KbCollabRoom(id, initial);
            synchronized (r) {
                r.sessions.add(session);
            }
            return r;
        });
        // 向新会话回放已存内容 + 翻转 synced + 索要其全量状态（把它的离线/本地编辑并入服务端与其它端）
        synchronized (room) {
            try {
                for (byte[] frame : room.updateLog) {
                    session.sendMessage(new BinaryMessage(frame));
                }
                session.sendMessage(new BinaryMessage(YProtocol.SYNC_STEP2_EMPTY)); // 翻转客户端 synced=true
                session.sendMessage(new BinaryMessage(YProtocol.SYNC_STEP1_EMPTY_SV)); // 索要全量
            } catch (Exception e) {
                log.debug("kb 协同初始同步失败 doc={}: {}", docId, e.getMessage());
            }
        }
        log.debug("kb 协同连入 doc={} user={} 房间在线={}", docId, session.getAttributes().get(
                KbCollabHandshakeInterceptor.ATTR_USER_NAME), room.sessionCount());
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
        Long docId = docId(session);
        KbCollabRoom room = docId == null ? null : rooms.get(docId);
        if (room == null) {
            return;
        }
        ByteBuffer bb = message.getPayload();
        byte[] payload = new byte[bb.remaining()];
        bb.get(payload);
        if (payload.length == 0) {
            return;
        }
        YProtocol.Classified c = YProtocol.classify(payload);

        synchronized (room) {
            // 1) 压实拉取的全量应答：唯一在线会话对我方 SyncStep1(空SV) 的 SyncStep2 回复 → 用单帧替换日志
            if (c.isPersistableUpdate() && c.syncType() == YProtocol.SYNC_STEP2
                    && room.pullTarget == session && room.sessionCount() == 1) {
                if (payload.length <= KbCollabRoom.MAX_FRAME_BYTES) {
                    room.replaceWithFullState(payload);
                }
                room.pullTarget = null;
                return; // 唯一会话，无需广播
            }
            // 2) 承载内容的更新（sync/step2、sync/update）：持久化 + 广播
            if (c.isPersistableUpdate()) {
                if (payload.length <= KbCollabRoom.MAX_FRAME_BYTES) {
                    room.appendUpdate(payload);
                }
                broadcastLocked(room, session, payload);
                maybeCompactLocked(room);
                return;
            }
            // 3) 客户端 SyncStep1：广播给对端（有更全状态者应答）+ 回一条空 SyncStep2 翻转其 synced
            if (c.isSyncStep1()) {
                broadcastLocked(room, session, payload);
                sendLocked(session, YProtocol.SYNC_STEP2_EMPTY);
                return;
            }
            // 4) awareness / queryAwareness / 未知：只广播不持久化（在线状态是瞬态）
            broadcastLocked(room, session, payload);
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        // y-websocket 协议是二进制；文本消息忽略（不关连接，避免误伤）。
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.debug("kb 协同传输错误 doc={}: {}", docId(session), exception.getMessage());
        closeQuietly(session, CloseStatus.SERVER_ERROR);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Long docId = docId(session);
        if (docId == null) {
            return;
        }
        byte[][] blobToPersist = new byte[1][];
        rooms.compute(docId, (id, cur) -> {
            if (cur == null) {
                return null;
            }
            synchronized (cur) {
                cur.sessions.remove(session);
                if (cur.pullTarget == session) {
                    cur.pullTarget = null;
                }
                if (cur.sessions.isEmpty()) {
                    if (cur.dirty) {
                        blobToPersist[0] = YProtocol.frame(cur.snapshotFrames());
                        cur.dirty = false;
                    }
                    return null; // 房间清空 → 从 map 移除
                }
            }
            return cur;
        });
        if (blobToPersist[0] != null) {
            safeSaveYdoc(docId, blobToPersist[0]);
        }
        log.debug("kb 协同断开 doc={} status={}", docId, status);
    }

    // ---------------------------------------------------------------------
    // 内部：广播 / 压实 / 落库（均要求持有 synchronized(room)，除持久化 IO 外）
    // ---------------------------------------------------------------------

    /** 广播 payload 给房间内除 sender 外的所有会话。要求持有 room 锁。 */
    private void broadcastLocked(KbCollabRoom room, WebSocketSession sender, byte[] payload) {
        for (WebSocketSession s : room.sessions) {
            if (s == sender || !s.isOpen()) {
                continue;
            }
            sendLocked(s, payload);
        }
    }

    private void sendLocked(WebSocketSession s, byte[] payload) {
        try {
            s.sendMessage(new BinaryMessage(payload));
        } catch (Exception e) {
            log.debug("kb 协同转发失败: {}", e.getMessage());
        }
    }

    /** 日志过大且当前仅一名在线会话时，向其索要全量状态以压实（下一条其 SyncStep2 会替换日志）。要求持有 room 锁。 */
    private void maybeCompactLocked(KbCollabRoom room) {
        if (room.needsCompaction() && room.sessionCount() == 1 && room.pullTarget == null) {
            WebSocketSession only = room.sessions.iterator().next();
            room.pullTarget = only;
            sendLocked(only, YProtocol.SYNC_STEP1_EMPTY_SV);
        }
    }

    private void flushDirtyRooms() {
        for (KbCollabRoom room : rooms.values()) {
            persist(room);
        }
    }

    /** 把脏房间当前日志分帧落库；先置 dirty=false，失败回滚为 true 下轮重试。 */
    private void persist(KbCollabRoom room) {
        byte[] blob;
        synchronized (room) {
            if (!room.dirty) {
                return;
            }
            blob = YProtocol.frame(room.snapshotFrames());
            room.dirty = false;
        }
        try {
            kbCollabPort.saveYdoc(room.docId, blob);
        } catch (Exception e) {
            log.warn("kb 协同 ydoc 落库失败 doc={}: {}", room.docId, e.getMessage());
            synchronized (room) {
                room.dirty = true;
            }
        }
    }

    private byte[] safeLoadYdoc(Long docId) {
        try {
            return kbCollabPort.loadYdoc(docId);
        } catch (Exception e) {
            log.warn("kb 协同 ydoc 冷载失败 doc={}: {}", docId, e.getMessage());
            return null;
        }
    }

    private void safeSaveYdoc(Long docId, byte[] blob) {
        try {
            kbCollabPort.saveYdoc(docId, blob);
        } catch (Exception e) {
            log.warn("kb 协同 ydoc 落库失败 doc={}: {}", docId, e.getMessage());
        }
    }

    private Long docId(WebSocketSession session) {
        Object v = session.getAttributes().get(KbCollabHandshakeInterceptor.ATTR_DOC_ID);
        return v instanceof Long l ? l : null;
    }

    private void closeQuietly(WebSocketSession session, CloseStatus status) {
        try {
            session.close(status);
        } catch (Exception ignored) {
            // ignore
        }
    }
}
