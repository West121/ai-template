package com.hentor.oa.office.knowledge.service;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.office.knowledge.dto.KbDtos.KbStats;
import com.hentor.oa.office.knowledge.dto.KbDtos.MemberRequest;
import com.hentor.oa.office.knowledge.dto.KbDtos.MemberResponse;
import com.hentor.oa.office.knowledge.dto.KbDtos.RecentDoc;
import com.hentor.oa.office.knowledge.dto.KbDtos.SpaceRequest;
import com.hentor.oa.office.knowledge.dto.KbDtos.SpaceResponse;
import com.hentor.oa.office.knowledge.entity.KbDoc;
import com.hentor.oa.office.knowledge.entity.KbSpace;
import com.hentor.oa.office.knowledge.entity.KbSpaceMember;
import com.hentor.oa.office.knowledge.repository.KbCommentRepository;
import com.hentor.oa.office.knowledge.repository.KbDocContentRepository;
import com.hentor.oa.office.knowledge.repository.KbDocRepository;
import com.hentor.oa.office.knowledge.repository.KbDocTagRepository;
import com.hentor.oa.office.knowledge.repository.KbDocVersionRepository;
import com.hentor.oa.office.knowledge.repository.KbSpaceMemberRepository;
import com.hentor.oa.office.knowledge.repository.KbSpaceRepository;
import com.hentor.oa.office.knowledge.support.KbAccess;
import com.hentor.oa.office.knowledge.support.KbNameResolver;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 知识空间 CRUD + 成员管理（ai-knowledge-base.md §2/§5）。
 * 列表/详情按可见空间过滤（{@link KbAccess#visibleSpaceSpec()}，红线：不可见空间不返回）。
 */
@Service
@RequiredArgsConstructor
public class KbSpaceService {

    /** 统计「最近更新」取的文档条数（批5）。 */
    private static final int RECENT_DOCS_TOP_N = 5;

    private static final Set<String> VISIBILITIES =
            Set.of(KbSpace.VIS_PUBLIC, KbSpace.VIS_INTERNAL, KbSpace.VIS_PRIVATE);
    private static final Set<String> PRINCIPAL_TYPES =
            Set.of(KbSpaceMember.PRINCIPAL_USER, KbSpaceMember.PRINCIPAL_DEPT, KbSpaceMember.PRINCIPAL_ROLE);
    private static final Set<String> MEMBER_ROLES =
            Set.of(KbSpaceMember.ROLE_VIEWER, KbSpaceMember.ROLE_EDITOR, KbSpaceMember.ROLE_ADMIN);

    private final KbSpaceRepository spaceRepository;
    private final KbSpaceMemberRepository memberRepository;
    private final KbDocRepository docRepository;
    private final KbDocContentRepository contentRepository;
    private final KbDocVersionRepository versionRepository;
    private final KbCommentRepository commentRepository;
    private final KbDocTagRepository docTagRepository;
    private final KbEmbeddingService embeddingService;
    private final KbAccess access;
    private final KbNameResolver nameResolver;

    /**
     * 当前用户「可编辑」（EDITOR/ADMIN）的知识空间。供 AI 对话固化（knowledge_save）解析目标空间：
     * 复用可见空间口径（{@link #list()}）再按 myRole 过滤——与 stats 的 editableSpaceCount 同一判定。
     */
    public List<SpaceResponse> editableSpaces() {
        return list().stream()
                .filter(s -> KbSpaceMember.ROLE_EDITOR.equals(s.myRole())
                        || KbSpaceMember.ROLE_ADMIN.equals(s.myRole()))
                .toList();
    }

    /** 当前用户可见的空间列表（可见性 + 成员过滤）。 */
    public List<SpaceResponse> list() {
        List<KbSpace> spaces = spaceRepository.findAll(
                access.visibleSpaceSpec(), Sort.by(Sort.Order.asc("sort"), Sort.Order.asc("id")));
        if (spaces.isEmpty()) {
            return List.of();
        }
        List<Long> ids = spaces.stream().map(KbSpace::getId).toList();
        Map<Long, Long> memberCounts = memberRepository.findBySpaceIdIn(ids).stream()
                .collect(Collectors.groupingBy(KbSpaceMember::getSpaceId, Collectors.counting()));
        return spaces.stream()
                .map(s -> toResponse(s, memberCounts.getOrDefault(s.getId(), 0L),
                        docRepository.countBySpaceId(s.getId())))
                .toList();
    }

    /**
     * 批5 · 知识库统计概览（集成收尾，ai-knowledge-base.md §7 批5）。
     * <b>严格按当前用户可见空间口径</b>（{@link KbAccess#visibleSpaceSpec()}，红线：不含不可见空间的
     * 空间/文档/标签——不为超管开后门）。recentDocs 取可见空间内最近更新 Top-N。
     */
    public KbStats stats() {
        List<KbSpace> spaces = spaceRepository.findAll(
                access.visibleSpaceSpec(), Sort.by(Sort.Order.asc("sort"), Sort.Order.asc("id")));
        if (spaces.isEmpty()) {
            return new KbStats(0L, 0L, 0L, 0L, List.of());
        }
        List<Long> spaceIds = spaces.stream().map(KbSpace::getId).toList();
        Map<Long, String> nameById = new HashMap<>();
        long editableSpaceCount = 0L;
        for (KbSpace s : spaces) {
            nameById.put(s.getId(), s.getName());
            if (access.canEdit(s)) {
                editableSpaceCount++;
            }
        }
        long docCount = docRepository.countByTypeAndSpaceIdIn(KbDoc.TYPE_DOC, spaceIds);
        long tagCount = docTagRepository.countDistinctTagInSpaces(spaceIds);
        List<RecentDoc> recentDocs = docRepository
                .findRecentDocs(KbDoc.TYPE_DOC, spaceIds, PageRequest.of(0, RECENT_DOCS_TOP_N)).stream()
                .map(d -> new RecentDoc(d.getId(), d.getTitle(), d.getSpaceId(),
                        nameById.get(d.getSpaceId()),
                        d.getUpdatedAt() != null ? d.getUpdatedAt() : d.getCreatedAt()))
                .toList();
        return new KbStats(spaces.size(), docCount, editableSpaceCount, tagCount, recentDocs);
    }

    /** 空间详情（须可见）。 */
    public SpaceResponse get(Long id) {
        KbSpace space = requireVisibleSpace(id);
        long memberCount = memberRepository.findBySpaceId(id).size();
        return toResponse(space, memberCount, docRepository.countBySpaceId(id));
    }

    /** 内部：加载并校验可见性，供文档服务复用。 */
    public KbSpace requireVisibleSpace(Long id) {
        KbSpace space = spaceRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireView(space);
        return space;
    }

    @Transactional
    public SpaceResponse create(SpaceRequest req) {
        UserContext user = access.currentUser();
        if (!StringUtils.hasText(req.code())) {
            throw new BusinessException("空间编码不能为空");
        }
        if (spaceRepository.existsByCode(req.code())) {
            throw new BusinessException(409, "空间编码已存在：" + req.code());
        }
        KbSpace space = new KbSpace();
        space.setName(req.name());
        space.setCode(req.code());
        space.setDescription(req.description());
        space.setIcon(req.icon());
        space.setVisibility(normalizeVisibility(req.visibility()));
        space.setOwnerId(user.getUserId());
        space.setSort(req.sort() != null ? req.sort() : 0);
        space.setStatus(KbSpace.STATUS_ACTIVE);
        KbSpace saved = spaceRepository.save(space);
        // 创建者即 owner（有效角色 ADMIN），无需额外成员行。
        return toResponse(saved, 0L, 0L);
    }

    @Transactional
    public SpaceResponse update(Long id, SpaceRequest req) {
        KbSpace space = spaceRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireManage(space);
        space.setName(req.name());
        if (req.description() != null) {
            space.setDescription(req.description());
        }
        if (req.icon() != null) {
            space.setIcon(req.icon());
        }
        if (StringUtils.hasText(req.visibility())) {
            space.setVisibility(normalizeVisibility(req.visibility()));
        }
        if (req.sort() != null) {
            space.setSort(req.sort());
        }
        space.setUpdatedAt(OffsetDateTime.now());
        KbSpace saved = spaceRepository.save(space);
        long memberCount = memberRepository.findBySpaceId(id).size();
        return toResponse(saved, memberCount, docRepository.countBySpaceId(id));
    }

    /** 删除空间：级联清理其下文档/正文/标签关联/成员。 */
    @Transactional
    public void delete(Long id) {
        KbSpace space = spaceRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireManage(space);
        List<Long> docIds = docRepository.findBySpaceIdOrderBySortAscIdAsc(id).stream()
                .map(KbDoc::getId).toList();
        if (!docIds.isEmpty()) {
            docTagRepository.deleteByDocIdIn(docIds);
            contentRepository.deleteByDocIdIn(docIds);
            versionRepository.deleteByDocIdIn(docIds); // 批4a：级联删版本快照
            commentRepository.deleteByDocIdIn(docIds); // 批4a：级联删评论
            embeddingService.deleteByDocIds(docIds); // 批2：级联删分块向量
            docRepository.deleteAllByIdInBatch(docIds);
        }
        memberRepository.deleteBySpaceId(id);
        spaceRepository.delete(space);
    }

    // ---------- 成员 ----------

    public List<MemberResponse> members(Long spaceId) {
        requireVisibleSpace(spaceId);
        return memberRepository.findBySpaceIdOrderByIdAsc(spaceId).stream()
                .map(this::toMemberResponse)
                .toList();
    }

    @Transactional
    public MemberResponse addMember(Long spaceId, MemberRequest req) {
        KbSpace space = spaceRepository.findById(spaceId)
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireManage(space);
        if (!PRINCIPAL_TYPES.contains(req.principalType())) {
            throw new BusinessException("非法的成员主体类型：" + req.principalType());
        }
        if (req.principalId() == null) {
            throw new BusinessException("成员主体 id 不能为空");
        }
        String role = StringUtils.hasText(req.role()) ? req.role() : KbSpaceMember.ROLE_VIEWER;
        if (!MEMBER_ROLES.contains(role)) {
            throw new BusinessException("非法的成员角色：" + role);
        }
        KbSpaceMember member = memberRepository
                .findBySpaceIdOrderByIdAsc(spaceId).stream()
                .filter(m -> m.getPrincipalType().equals(req.principalType())
                        && m.getPrincipalId().equals(req.principalId()))
                .findFirst()
                .orElseGet(KbSpaceMember::new);
        member.setSpaceId(spaceId);
        member.setPrincipalType(req.principalType());
        member.setPrincipalId(req.principalId());
        member.setRole(role);
        return toMemberResponse(memberRepository.save(member));
    }

    @Transactional
    public void removeMember(Long spaceId, Long memberId) {
        KbSpace space = spaceRepository.findById(spaceId)
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在"));
        access.requireManage(space);
        KbSpaceMember member = memberRepository.findById(memberId)
                .orElseThrow(() -> new BusinessException(404, "成员不存在"));
        if (!member.getSpaceId().equals(spaceId)) {
            throw new BusinessException("成员不属于该空间");
        }
        memberRepository.delete(member);
    }

    // ---------- 映射 ----------

    private SpaceResponse toResponse(KbSpace s, long memberCount, long docCount) {
        return new SpaceResponse(
                s.getId(), s.getName(), s.getCode(), s.getDescription(), s.getIcon(),
                s.getVisibility(), s.getOwnerId(), nameResolver.userName(s.getOwnerId()),
                s.getSort(), s.getStatus(), access.effectiveRole(s), memberCount, docCount,
                s.getCreatedAt(), s.getUpdatedAt());
    }

    private MemberResponse toMemberResponse(KbSpaceMember m) {
        return new MemberResponse(
                m.getId(), m.getPrincipalType(), m.getPrincipalId(),
                nameResolver.principalName(m.getPrincipalType(), m.getPrincipalId()),
                m.getRole(), m.getCreatedAt());
    }

    private String normalizeVisibility(String visibility) {
        String v = StringUtils.hasText(visibility) ? visibility.toUpperCase() : KbSpace.VIS_INTERNAL;
        if (!VISIBILITIES.contains(v)) {
            throw new BusinessException("非法的可见性：" + visibility);
        }
        return v;
    }
}
