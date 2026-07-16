package com.hentor.oa.boot.ai.repository;

import com.hentor.oa.boot.ai.entity.AiChatSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;

public interface AiChatSessionRepository extends JpaRepository<AiChatSession, Long> {

    List<AiChatSession> findByUserIdAndCreatedAtAfterOrderByUpdatedAtDesc(Long userId, OffsetDateTime after);

    /**
     * §15.2 会话串行化获取：IDLE → RUNNING 原子更新（PG 乐观锁，不用 Redis）。
     * 返回 0 = 会话正在处理另一条消息 → AI_SESSION_BUSY(409)。
     */
    @Modifying
    @Transactional
    @Query("update AiChatSession s set s.status = 'RUNNING', s.version = s.version + 1 "
            + "where s.id = :id and s.status = 'IDLE'")
    int acquire(Long id);

    /** 串行化释放：RUNNING → IDLE（执行 finally 必调）。 */
    @Modifying
    @Transactional
    @Query("update AiChatSession s set s.status = 'IDLE', s.version = s.version + 1 "
            + "where s.id = :id and s.status = 'RUNNING'")
    int release(Long id);

    /** 启动恢复：崩溃遗留 RUNNING 全量复位（附2：进程重启后不留死锁会话）。 */
    @Modifying
    @Transactional
    @Query("update AiChatSession s set s.status = 'IDLE' where s.status = 'RUNNING'")
    int resetRunningAll();
}
