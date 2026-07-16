-- ============================================================
-- OA Platform - V50 品牌更名：星辰科技 → 涵韬科技（包名同步 com.xingchen → com.hentor，代码层完成）
--
--   历史迁移文件（V1/V20/V36/V39/V41 种子）一字不动（Flyway 校验和红线）；
--   本迁移只 UPDATE 数据行。新装语义：V1..V49 先种「星辰」，V50 统一改「涵韬」——可接受，最终态一致。
--   改名映射：星辰→涵韬（公司名/文案）；星发→涵发（旧公文字号）；星辰发/星辰办→涵韬发/涵韬办（文号机关代字）。
--   范围依据：全库 text/varchar 列 LIKE 扫描 + act_ge_bytearray bytea 扫描（部署物/designerJson
--   均无 com.xingchen 与品牌串硬引用——delegateExpression 走 bean 名，无包名，改包零库影响）。
-- ============================================================

-- 1. 组织：根部门（V1 种子）+ 用户冗余部门名列
UPDATE sys_dept SET name = '涵韬科技' WHERE name = '星辰科技';
UPDATE sys_user SET dept = replace(dept, '星辰科技', '涵韬科技') WHERE dept LIKE '%星辰科技%';

-- 2. 公文文号规则（V20 种子：XCF 星辰发文/星辰发、XCB 星辰办公室发文/星辰办）
UPDATE oa_doc_number_rule
SET name = replace(name, '星辰', '涵韬'), org_code = replace(org_code, '星辰', '涵韬')
WHERE name LIKE '%星辰%' OR org_code LIKE '%星辰%';

-- 3. 红头模板（V20 种子：星辰科技红头文件 / 星辰科技有限公司文件）
UPDATE oa_doc_template
SET name = replace(name, '星辰', '涵韬'), issuing_org = replace(issuing_org, '星辰', '涵韬')
WHERE name LIKE '%星辰%' OR issuing_org LIKE '%星辰%';

-- 4. 历史文号与公文：旧「星发〔yyyy〕N号」与规则文号「星辰发/星辰办〔yyyy〕NNN号」统一换字号
--    （replace 为 1:1 映射，不破坏 doc_number 唯一性）
UPDATE oa_document SET code = replace(replace(code, '星辰', '涵韬'), '星发', '涵发')
WHERE code LIKE '%星辰%' OR code LIKE '%星发%';
UPDATE oa_document SET issuing_org = replace(issuing_org, '星辰', '涵韬') WHERE issuing_org LIKE '%星辰%';
UPDATE oa_doc_number_ledger SET doc_number = replace(replace(doc_number, '星辰', '涵韬'), '星发', '涵发')
WHERE doc_number LIKE '%星辰%' OR doc_number LIKE '%星发%';

-- 5. AI 知识种子（V36：系统使用指南等文案含「星辰」）
UPDATE ai_knowledge_doc SET title = replace(title, '星辰', '涵韬'), content = replace(content, '星辰', '涵韬')
WHERE title LIKE '%星辰%' OR content LIKE '%星辰%';

-- 6. 知识库种子（V39/V41：文档正文与版本快照）
UPDATE kb_doc_content
SET content_json = replace(content_json, '星辰', '涵韬'), content_text = replace(content_text, '星辰', '涵韬')
WHERE content_json LIKE '%星辰%' OR content_text LIKE '%星辰%';
UPDATE kb_doc_version
SET content_json = replace(content_json, '星辰', '涵韬'), content_text = replace(content_text, '星辰', '涵韬')
WHERE content_json LIKE '%星辰%' OR content_text LIKE '%星辰%';
