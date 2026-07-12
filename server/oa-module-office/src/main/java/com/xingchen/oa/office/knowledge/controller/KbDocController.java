package com.xingchen.oa.office.knowledge.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.log.OperLog;
import com.xingchen.oa.office.knowledge.dto.KbDtos.ContentSaveRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.DocCreateRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.DocDetail;
import com.xingchen.oa.office.knowledge.dto.KbDtos.DocTagRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.DocTreeNode;
import com.xingchen.oa.office.knowledge.dto.KbDtos.DocUpdateRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.TagResponse;
import com.xingchen.oa.office.knowledge.dto.KbDtos.VersionContent;
import com.xingchen.oa.office.knowledge.dto.KbDtos.VersionResponse;
import com.xingchen.oa.office.knowledge.entity.KbDoc;
import com.xingchen.oa.office.knowledge.service.KbDocService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 知识库目录树 + 文档（ai-knowledge-base.md §2/§7 批1）。
 * 读须对空间可见（kb:doc:view + canView）；写须空间 EDITOR/ADMIN（kb:doc:edit + canEdit）。
 */
@RestController
@RequestMapping("/api/kb/docs")
@RequiredArgsConstructor
public class KbDocController {

    private final KbDocService docService;

    /** 空间下目录树（树形）。 */
    @GetMapping("/tree")
    @PreAuthorize("hasAuthority('kb:doc:view')")
    public R<List<DocTreeNode>> tree(@RequestParam Long spaceId) {
        return R.ok(docService.tree(spaceId));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('kb:doc:view')")
    public R<DocDetail> detail(@PathVariable Long id) {
        return R.ok(docService.detail(id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    @OperLog(module = "知识库", action = "新建节点")
    public R<DocDetail> create(@Valid @RequestBody DocCreateRequest request) {
        return R.ok(docService.create(request));
    }

    /** 改标题 / 移动(parentId=0 移到根) / 排序。 */
    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    @OperLog(module = "知识库", action = "修改节点")
    public R<DocDetail> update(@PathVariable Long id, @RequestBody DocUpdateRequest request) {
        return R.ok(docService.update(id, request));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    @OperLog(module = "知识库", action = "删除节点")
    public R<Void> delete(@PathVariable Long id) {
        docService.delete(id);
        return R.ok();
    }

    /** 保存正文（content_json + content_text），文档版本号自增。 */
    @PutMapping("/{id}/content")
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    @OperLog(module = "知识库", action = "保存正文")
    public R<DocDetail> saveContent(@PathVariable Long id, @RequestBody ContentSaveRequest request) {
        return R.ok(docService.saveContent(id, request));
    }

    @PostMapping("/{id}/publish")
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    @OperLog(module = "知识库", action = "发布文档")
    public R<DocDetail> publish(@PathVariable Long id) {
        return R.ok(docService.changeStatus(id, KbDoc.STATUS_PUBLISHED));
    }

    @PostMapping("/{id}/archive")
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    @OperLog(module = "知识库", action = "归档文档")
    public R<DocDetail> archive(@PathVariable Long id) {
        return R.ok(docService.changeStatus(id, KbDoc.STATUS_ARCHIVED));
    }

    // ---------- 版本历史（批4a）----------

    /** 版本列表（version 降序）。 */
    @GetMapping("/{id}/versions")
    @PreAuthorize("hasAuthority('kb:doc:view')")
    public R<List<VersionResponse>> versions(@PathVariable Long id) {
        return R.ok(docService.listVersions(id));
    }

    /** 某版本正文（contentJson + contentText）。 */
    @GetMapping("/{id}/versions/{version}")
    @PreAuthorize("hasAuthority('kb:doc:view')")
    public R<VersionContent> versionContent(@PathVariable Long id, @PathVariable Integer version) {
        return R.ok(docService.versionContent(id, version));
    }

    /** 回滚到指定版本：以该版正文另存为新版本（不销毁历史）。 */
    @PostMapping("/{id}/rollback/{version}")
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    @OperLog(module = "知识库", action = "回滚版本")
    public R<DocDetail> rollback(@PathVariable Long id, @PathVariable Integer version) {
        return R.ok(docService.rollback(id, version));
    }

    // ---------- 文档标签 ----------

    @GetMapping("/{id}/tags")
    @PreAuthorize("hasAuthority('kb:doc:view')")
    public R<List<TagResponse>> tags(@PathVariable Long id) {
        return R.ok(docService.docTags(id));
    }

    @PostMapping("/{id}/tags")
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    @OperLog(module = "知识库", action = "文档打标签")
    public R<TagResponse> addTag(@PathVariable Long id, @RequestBody DocTagRequest request) {
        return R.ok(docService.addDocTag(id, request));
    }

    @DeleteMapping("/{id}/tags/{tagId}")
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    @OperLog(module = "知识库", action = "文档移除标签")
    public R<Void> removeTag(@PathVariable Long id, @PathVariable Long tagId) {
        docService.removeDocTag(id, tagId);
        return R.ok();
    }
}
