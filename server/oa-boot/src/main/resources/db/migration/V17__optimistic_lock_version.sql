-- ============================================================
-- OA Platform - V17 乐观锁 @Version 列（B-07）
--   给并发写热点实体加 version 列，配合 JPA @Version 实现乐观锁：
--     oa_approval  —— approve/reject/withdraw 并发只允许一个成功
--     wf_add_sign  —— 加签串行链 advance 并发推进只允许一个成功
--   冲突时 Hibernate 抛 OptimisticLockException，服务层转 BusinessException(409)。
--   既有行默认 version=0；ddl-auto=validate 需列类型与实体 Long 对齐（BIGINT）。
-- ============================================================

ALTER TABLE oa_approval ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE wf_add_sign ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
