# 企业级 AI 知识库设计

> 用户裁定(2026-07-12):**完整产品(分批)** + **全套 AI 能力**(问答/写作辅助/自动处理/相关推荐/对话固化) + **实时协同(CRDT)**。

## 0. 定位与复用资产

不只是文档管理,而是**让知识可问、可生成、可推荐**的 AI 驱动平台。**在批D 已有地基上生长**,不从零:
- **RAG 地基**:`ai_knowledge_doc`(pgvector 语义 + 全文降级) + `RetrievalAugmentationAdvisor` + `AiEmbeddingService`(升级为知识库文档源)。
- **富文本**:`web/src/components/rich-text/`(TipTap editor/toolbar/viewer)。
- **AI 编排**:`LlmToolLoop`(写作辅助/自动处理);`AiChatService`(问答)。
- **权限**:RBAC(功能权限)+ 数据权限(DataScope);**FileService**(附件);Aviator(无关)。
- **图表/卡片**:复用(知识库统计)。

## 1. 架构分层

```
知识组织层  空间 Space → 目录树 → 文档 Doc(TipTap) → 标签/附件
AI 能力层   问答(RAG+引用) / 写作辅助 / 自动处理(摘要·标签·FAQ) / 相关推荐 / 对话固化
检索层      语义(pgvector) + 全文(tsvector) 混合 + 空间/标签/作者/时间 过滤
协作层      版本(diff/回滚) + 评论/@ + 实时协同(CRDT: Yjs)
集成层      文档→AI 助手 RAG 源;权限继承 RBAC+数据权限;AI 助手对话固化入库
```

## 2. 数据模型(迁移 V{n} 起,表前缀 kb_)

- **kb_space**(知识空间):id/name/code/description/icon/visibility(PUBLIC|INTERNAL|PRIVATE)/owner_id/
  tenant_id('default')/sort/status/created。
- **kb_space_member**(空间成员权限):space_id/principal_type(USER|DEPT|ROLE)/principal_id/
  role(VIEWER|EDITOR|ADMIN)。空间级 RBAC。
- **kb_doc**(文档/目录节点):id/space_id/parent_id(树)/type(FOLDER|DOC)/title/sort/
  summary(AI 摘要)/status(DRAFT|PUBLISHED|ARCHIVED)/creator_id/updater_id/version/created/updated。
- **kb_doc_content**(当前正文,与 doc 1:1):doc_id/content_json(TipTap JSON)/content_text(纯文本,
  供索引/检索)/ydoc(bytea,Yjs 二进制文档状态,CRDT 用)。
- **kb_doc_version**(版本历史):id/doc_id/version/content_json/content_text/editor_id/note/created。
- **kb_tag** + **kb_doc_tag**(标签,AI 自动+手动)。
- **kb_comment**(评论/@):id/doc_id/parent_id/user_id/content/anchor(选区锚点可空)/created。
- **kb_doc_embedding**(分块向量,替换/扩展 ai_knowledge_doc):doc_id/chunk_seq/chunk_text/
  embedding(vector,可空→全文降级)/updated。文档保存→重新分块+嵌入(有凭据)。
- 复用:ai_knowledge_doc 保留兼容,RAG Advisor 检索源改为 kb_doc_embedding ∪ ai_knowledge_doc。

## 3. AI 能力(差异化核心,复用 LlmToolLoop/RAG)

1. **AI 问答**:独立"问知识库"入口 + AI 助手联动。RAG 检索 kb_doc_embedding(按空间/权限过滤)→
   基于文档回答 + **引用溯源**(KB_DOC{docId,title,space})。复用 RetrievalAugmentationAdvisor,
   检索源扩到知识库 + 权限过滤(仅可见空间)。
2. **AI 写作辅助**:编辑器工具栏/选区菜单 → 续写/润色/总结/生成大纲/纠错/翻译。POST /api/kb/ai/assist
   (action + 选中文本/全文上下文)→ LlmToolLoop 流式返回,编辑器插入/替换。
3. **AI 自动处理**:文档保存/上传 → 异步(编排或 @Async)生成 summary(存 kb_doc.summary)/自动标签/
   分类/抽取要点/生成 FAQ。上传 md/docx/pdf → 抽取正文入库 + 自动处理。
4. **相关推荐**:文档详情侧栏"相关文档"——pgvector 余弦相似 Top-N(同空间/可见);无嵌入降级全文相似。
5. **对话固化**:AI 助手工具 `knowledge_save`(把选定对话片段/生成内容存进指定空间为草稿文档)+
   "总结这个流程/审批成文档"。风险 EXPLICIT_UI_SUBMIT(确认卡)。

## 4. 实时协同(CRDT,用户要求)—— 最重工程,独立批次

- **选型**:**Yjs**(CRDT)+ TipTap `Collaboration`/`CollaborationCursor` 扩展(前端已用 TipTap);
  传输 **WebSocket**。后端承载 y-protocol:
  - 方案A(推荐):Spring Boot **WebSocket 端点** `/ws/kb/doc/{docId}` 承载 Yjs update 二进制广播 +
    持久化(房间内存 Y.Doc,定期/离开时把 ydoc 落 kb_doc_content.ydoc,并 encodeStateAsUpdate)。
  - 方案B:独立 Hocuspocus(Node)协同服务——引入额外进程,暂不选(保持 Java 单体)。
- 权限:握手校验(JWT + 文档 EDITOR 权限);在线光标/头像(CollaborationCursor)。
- 与版本:实时协同期间不产版本;显式"保存版本"或定时快照→ kb_doc_version。
- **降级**:WebSocket 不可用 → 退回单人编辑 + 编辑锁(乐观锁 version,冲突提示)。CRDT 是增强不是唯一路径。

## 5. 权限模型

- 空间级:kb_space_member(VIEWER/EDITOR/ADMIN) + visibility(PUBLIC 全员可见/INTERNAL 登录可见/
  PRIVATE 仅成员)。功能权限码 `kb:space:manage`/`kb:doc:edit` 等,@PreAuthorize。
- 文档级(可选覆盖):默认继承空间;敏感文档可单独限。
- 数据权限:列表/检索按可见空间过滤(Specification);AI 问答/推荐**只检索可见空间**(红线:不越权泄露)。

## 6. 前端(web/src/pages/knowledge/)

- 菜单加"知识库"(config/menu.ts,path /knowledge)。空间列表 → 空间内(左目录树 + 右文档)。
- 文档编辑器:复用 rich-text(TipTap)+ 协同扩展 + AI 写作辅助工具条/选区菜单 + 相关文档侧栏。
- "问知识库"页/入口:对话式问答(复用 ai-chat 卡片/引用渲染或独立轻量)。
- 全文/语义搜索页;版本历史/diff;评论区。防白屏四层(编辑器/树/卡片各自边界)。

## 7. 分批实施

- **批1 知识组织+文档基础**:kb_space/member/doc/content/tag 表 + CRUD API + 权限;前端 空间/目录树/
  文档 TipTap 编辑(单人)+菜单。**先能建库、写文档、分权限**。
- **批2 检索+AI 问答+推荐**:混合检索(语义+全文)+ kb_doc_embedding 分块嵌入(保存触发)+ RAG 问答
  (基于知识库+引用,AI 助手检索源扩到 kb)+ 相关推荐。
- **批3 AI 写作辅助+自动处理+对话固化**:编辑器 AI 助手(续写/润色/总结/大纲)+ 保存自动摘要/标签/
  FAQ + 上传抽取 + AI 助手 knowledge_save 工具。
- **批4 协作(版本+评论+CRDT)**:版本历史/diff/回滚 + 评论/@ + **Yjs 实时协同**(WebSocket 端点+
  TipTap Collaboration,降级单人锁)。最重,独立批。
- **批5 集成收尾+治理**:知识库全面接入 AI 助手 RAG(替 3 篇种子)、统计、权限治理、审计、范式文档。

## 8. 复用与红线

- 尽量复用(TipTap/RAG/LlmToolLoop/权限/FileService/图表),不重造。
- 安全红线:AI 问答/推荐/检索**严格按用户可见空间过滤**,不跨权限泄露知识;写操作(对话固化/AI 生成
  入库)走草稿+人工确认,不直接发布。
- 每批行为兼容、可验、可回滚;防白屏四层贯穿;smoke(KEEP=1 自清)。
