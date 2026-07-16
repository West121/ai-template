package com.hentor.oa.boot.kb.collab;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * y-websocket / y-protocols 线协议帮助类（ai-knowledge-base.md §4 批4b）。
 *
 * <p><b>后端纯 relay，不解析 Yjs CRDT。</b>本类只做到「按消息头字节分类」与「构造几条固定的握手同步消息」，
 * 足以让后端：① 转发（广播）二进制消息；② 判定哪些消息承载「文档内容更新」值得持久化（sync/step2、sync/update）；
 * ③ 让首个/新连入的客户端拿到已有内容并翻转 {@code synced} 标志。</p>
 *
 * <p>协议参考（y-protocols）：外层消息第一个 varUint 是消息类型
 * （{@link #MSG_SYNC}=0 同步 / {@link #MSG_AWARENESS}=1 在线状态 / auth=2 / queryAwareness=3）；
 * 若为 sync，则紧跟第二个 varUint 是子类型
 * （{@link #SYNC_STEP1}=0 携带 state vector 的「把我缺的发我」/ {@link #SYNC_STEP2}=1 携带 update 的应答 /
 * {@link #SYNC_UPDATE}=2 增量 update）。update / state-vector 均以 varUint8Array（先 varUint 长度再字节）编码。</p>
 */
final class YProtocol {

    private YProtocol() {
    }

    // ---- 外层消息类型 ----
    static final int MSG_SYNC = 0;
    static final int MSG_AWARENESS = 1;
    static final int MSG_QUERY_AWARENESS = 3;

    // ---- sync 子类型 ----
    static final int SYNC_STEP1 = 0;
    static final int SYNC_STEP2 = 1;
    static final int SYNC_UPDATE = 2;

    /**
     * 「把你的完整状态发我」——SyncStep1(空 state vector)。收到方回 SyncStep2(全量 update)。
     * 编码：[MSG_SYNC=0, SYNC_STEP1=0, varUint8Array(空SV)]，空 SV = 单字节 0x00（0 个 client）。
     */
    static final byte[] SYNC_STEP1_EMPTY_SV = {0, 0, 1, 0};

    /**
     * 空 SyncStep2（携带一个「无变更」的空 update）。仅用于在已推送历史内容后翻转客户端 {@code synced=true}。
     * 编码：[MSG_SYNC=0, SYNC_STEP2=1, varUint8Array(空update)]，空 update = 两字节 0x00 0x00（0 结构 + 空删除集）。
     */
    static final byte[] SYNC_STEP2_EMPTY = {0, 1, 2, 0, 0};

    /** 变长无符号整数读游标。 */
    static final class VarReader {
        final byte[] buf;
        int pos;

        VarReader(byte[] buf) {
            this.buf = buf;
        }

        boolean hasMore() {
            return pos < buf.length;
        }

        /** 读一个 LEB128 varUint（够用即可，超过 32 位不做特殊处理）。越界抛 IndexOutOfBounds。 */
        long readVarUint() {
            long num = 0;
            int shift = 0;
            while (true) {
                int b = buf[pos++] & 0xff;
                num |= (long) (b & 0x7f) << shift;
                if ((b & 0x80) == 0) {
                    return num;
                }
                shift += 7;
            }
        }
    }

    /** 消息分类结果。 */
    record Classified(int msgType, int syncType) {
        /** 承载文档内容、值得持久化：sync/step2 或 sync/update（其 payload 是 Yjs update）。 */
        boolean isPersistableUpdate() {
            return msgType == MSG_SYNC && (syncType == SYNC_STEP2 || syncType == SYNC_UPDATE);
        }

        boolean isSyncStep1() {
            return msgType == MSG_SYNC && syncType == SYNC_STEP1;
        }
    }

    /** 只读消息头 1~2 个 varUint 做分类；畸形/过短消息 → msgType=-1（调用方仍会转发，只是不持久化）。 */
    static Classified classify(byte[] message) {
        try {
            VarReader r = new VarReader(message);
            int msgType = (int) r.readVarUint();
            int syncType = -1;
            if (msgType == MSG_SYNC && r.hasMore()) {
                syncType = (int) r.readVarUint();
            }
            return new Classified(msgType, syncType);
        } catch (RuntimeException e) {
            return new Classified(-1, -1);
        }
    }

    // ---- DB 快照的分帧编解码：4 字节大端长度前缀 + 消息字节，顺序拼接 ----

    /** 把内存里的一串完整消息帧编码为单个 blob（存入 kb_doc_content.ydoc）。 */
    static byte[] frame(List<byte[]> messages) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] m : messages) {
            int len = m.length;
            out.write((len >>> 24) & 0xff);
            out.write((len >>> 16) & 0xff);
            out.write((len >>> 8) & 0xff);
            out.write(len & 0xff);
            out.write(m, 0, len);
        }
        return out.toByteArray();
    }

    /** 还原 blob 为消息帧列表（新会话连入时逐帧回放）。畸形数据 → 尽力解析，异常即止（防白屏红线）。 */
    static List<byte[]> unframe(byte[] blob) {
        List<byte[]> out = new ArrayList<>();
        if (blob == null || blob.length == 0) {
            return out;
        }
        try {
            int i = 0;
            while (i + 4 <= blob.length) {
                int len = ((blob[i] & 0xff) << 24) | ((blob[i + 1] & 0xff) << 16)
                        | ((blob[i + 2] & 0xff) << 8) | (blob[i + 3] & 0xff);
                i += 4;
                if (len < 0 || i + len > blob.length) {
                    break; // 截断/畸形，停止
                }
                byte[] m = new byte[len];
                System.arraycopy(blob, i, m, 0, len);
                out.add(m);
                i += len;
            }
        } catch (RuntimeException e) {
            // 尽力而为，已解析到的照常返回
        }
        return out;
    }
}
