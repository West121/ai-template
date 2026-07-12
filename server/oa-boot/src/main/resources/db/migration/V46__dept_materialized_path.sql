-- ============================================================
-- V46 数据权限性能 · DP1b：部门物化路径（替代递归子树）
--   sys_dept 加 path（物化路径，如 '/1/4/12/'，含自身）；回填存量部门；建 text_pattern_ops 前缀索引。
--   子树查询 descendantDeptIds/DEPT_AND_CHILD 改 `path LIKE '/1/4/%'` 走索引，不跑递归 CTE。
--   向后兼容红线：path 与 ancestors 递归结果一致（保留 ancestors 不动，仅新增 path + 切子树查询）。
-- ============================================================
ALTER TABLE sys_dept ADD COLUMN path VARCHAR(512);

-- 回填：从 parent_id 链递归计算 path（根 parent_id=0/NULL）。一次性 CTE，非运行期递归。
WITH RECURSIVE dp AS (
    SELECT id, ('/' || id || '/')::varchar AS path
    FROM sys_dept
    WHERE parent_id = 0 OR parent_id IS NULL
    UNION ALL
    SELECT c.id, (dp.path || c.id || '/')::varchar
    FROM sys_dept c
    JOIN dp ON c.parent_id = dp.id
)
UPDATE sys_dept s SET path = dp.path FROM dp WHERE s.id = dp.id;

-- 兜底：任何未被 CTE 覆盖（孤儿/脏 parent_id）的置自身单段路径，保证 NOT NULL
UPDATE sys_dept SET path = '/' || id || '/' WHERE path IS NULL;

ALTER TABLE sys_dept ALTER COLUMN path SET NOT NULL;

-- text_pattern_ops：使 `path LIKE '/1/4/%'` 前缀匹配走索引（不受 locale/collation 影响）
CREATE INDEX idx_sys_dept_path ON sys_dept (path text_pattern_ops);
