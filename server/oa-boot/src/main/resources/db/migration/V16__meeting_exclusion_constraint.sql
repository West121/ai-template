-- ============================================================
-- OA Platform - V16 会议室预订竞态修复（B-03）
--   MeetingService 原为内存 check-then-insert，并发下同房间同日期
--   同时段可双双通过检查后各自落库，产生重叠预订。
--   这里在库层加 PostgreSQL 时间范围排他约束（EXCLUDE USING gist），
--   由数据库保证同一会议室、同一天、时段区间不重叠——真正的并发防线。
--
--   依赖 btree_gist 扩展：使 gist 索引支持 room_id(BIGINT)/meeting_date(DATE)
--   的等值操作符（= WITH gist）。
--   时段用半开区间 int4range(start_hour, end_hour) = [start, end)，
--   && 为区间重叠，与服务层 startHour < end && endHour > start 语义一致。
--   仅约束未取消的预订（status <> 'CANCELED'），取消的记录不参与冲突判定。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE oa_meeting
    ADD CONSTRAINT excl_oa_meeting_room_time
    EXCLUDE USING gist (
        room_id WITH =,
        meeting_date WITH =,
        int4range(start_hour, end_hour) WITH &&
    ) WHERE (status <> 'CANCELED');
