package com.xingchen.oa.office.knowledge.controller;

import com.xingchen.oa.common.core.R;
import com.xingchen.oa.common.log.OperLog;
import com.xingchen.oa.office.knowledge.dto.KbDtos.CommentRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.CommentResponse;
import com.xingchen.oa.office.knowledge.service.KbCommentService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 知识库文档评论 / 回复（ai-knowledge-base.md §2/§5，批4a）。
 * 看评论须对空间可见（kb:doc:view + canView）；发评论/回复须空间 EDITOR/ADMIN（kb:doc:edit + canEdit）；
 * 删评论限本人或空间 ADMIN（服务层强制）。
 */
@RestController
@RequestMapping("/api/kb")
@RequiredArgsConstructor
public class KbCommentController {

    private final KbCommentService commentService;

    /** 某文档评论列表（裸数组，created 升序；前端建回复树）。 */
    @GetMapping("/docs/{id}/comments")
    @PreAuthorize("hasAuthority('kb:doc:view')")
    public R<List<CommentResponse>> list(@PathVariable Long id) {
        return R.ok(commentService.list(id));
    }

    /** 发评论 / 回复。 */
    @PostMapping("/docs/{id}/comments")
    @PreAuthorize("hasAuthority('kb:doc:edit')")
    @OperLog(module = "知识库", action = "发表评论")
    public R<CommentResponse> create(@PathVariable Long id, @Valid @RequestBody CommentRequest request) {
        return R.ok(commentService.create(id, request));
    }

    /** 删评论（本人或空间 ADMIN）。 */
    @DeleteMapping("/comments/{commentId}")
    @PreAuthorize("hasAuthority('kb:doc:view')")
    @OperLog(module = "知识库", action = "删除评论")
    public R<Void> delete(@PathVariable Long commentId) {
        commentService.delete(commentId);
        return R.ok();
    }
}
