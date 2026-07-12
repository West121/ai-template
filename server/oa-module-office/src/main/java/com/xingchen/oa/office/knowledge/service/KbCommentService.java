package com.xingchen.oa.office.knowledge.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.office.knowledge.dto.KbDtos.CommentRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.CommentResponse;
import com.xingchen.oa.office.knowledge.entity.KbComment;
import com.xingchen.oa.office.knowledge.entity.KbDoc;
import com.xingchen.oa.office.knowledge.entity.KbSpace;
import com.xingchen.oa.office.knowledge.repository.KbCommentRepository;
import com.xingchen.oa.office.knowledge.repository.KbDocRepository;
import com.xingchen.oa.office.knowledge.repository.KbSpaceRepository;
import com.xingchen.oa.office.knowledge.support.KbAccess;
import com.xingchen.oa.office.knowledge.support.KbNameResolver;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 知识库文档评论 / 回复（ai-knowledge-base.md §2 kb_comment / §5 权限，批4a）。
 *
 * <p>权限红线：看评论须对空间可见（{@link KbAccess#requireView}）；发评论/回复须空间 EDITOR/ADMIN
 * （{@link KbAccess#requireEdit}）；删评论限本人或空间 ADMIN。@提及仅前端 content 内 “@名字” 文本，
 * 本批不做结构化 mentions/通知；anchor 存字段但本批文档级评论，通常为 null。</p>
 */
@Service
@RequiredArgsConstructor
public class KbCommentService {

    private final KbCommentRepository commentRepository;
    private final KbDocRepository docRepository;
    private final KbSpaceRepository spaceRepository;
    private final KbAccess access;
    private final KbNameResolver nameResolver;

    /** 某文档全部评论（created 升序，前端自建回复树）。须对空间可见。 */
    public List<CommentResponse> list(Long docId) {
        KbDoc doc = loadDoc(docId);
        access.requireView(loadSpace(doc));
        return commentRepository.findByDocIdOrderByCreatedAtAscIdAsc(docId).stream()
                .map(this::toResponse)
                .toList();
    }

    /** 发评论 / 回复。须空间 EDITOR/ADMIN；parentId 若给则须属同文档。 */
    @Transactional
    public CommentResponse create(Long docId, CommentRequest req) {
        KbDoc doc = loadDoc(docId);
        access.requireEdit(loadSpace(doc));
        if (!StringUtils.hasText(req.content())) {
            throw new BusinessException("评论内容不能为空");
        }
        if (req.parentId() != null) {
            KbComment parent = commentRepository.findById(req.parentId())
                    .orElseThrow(() -> new BusinessException(404, "父评论不存在"));
            if (!parent.getDocId().equals(docId)) {
                throw new BusinessException("父评论不属于该文档");
            }
        }
        KbComment comment = new KbComment();
        comment.setDocId(docId);
        comment.setParentId(req.parentId());
        comment.setUserId(access.currentUser().getUserId());
        comment.setContent(req.content().trim());
        comment.setAnchor(StringUtils.hasText(req.anchor()) ? req.anchor() : null);
        return toResponse(commentRepository.save(comment));
    }

    /** 删评论：本人或空间 ADMIN 可删（红线：他人评论仅 ADMIN 能删）。 */
    @Transactional
    public void delete(Long commentId) {
        KbComment comment = commentRepository.findById(commentId)
                .orElseThrow(() -> new BusinessException(404, "评论不存在"));
        KbDoc doc = loadDoc(comment.getDocId());
        KbSpace space = loadSpace(doc);
        access.requireView(space); // 不可见空间直接挡
        UserContext user = access.currentUser();
        boolean isAuthor = comment.getUserId() != null && comment.getUserId().equals(user.getUserId());
        if (!isAuthor && !access.canManage(space)) {
            throw new BusinessException(403, "只能删除本人评论（或由空间管理员删除）");
        }
        commentRepository.delete(comment);
    }

    // ---------- 辅助 ----------

    private KbDoc loadDoc(Long docId) {
        return docRepository.findById(docId)
                .orElseThrow(() -> new BusinessException(404, "文档不存在"));
    }

    private KbSpace loadSpace(KbDoc doc) {
        return spaceRepository.findById(doc.getSpaceId())
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
    }

    private CommentResponse toResponse(KbComment c) {
        return new CommentResponse(
                c.getId(), c.getDocId(), c.getParentId(),
                c.getUserId(), nameResolver.userName(c.getUserId()),
                c.getContent(), c.getAnchor(), c.getCreatedAt());
    }
}
