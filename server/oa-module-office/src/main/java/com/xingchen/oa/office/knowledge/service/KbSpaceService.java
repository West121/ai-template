package com.xingchen.oa.office.knowledge.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.office.knowledge.dto.KbDtos.MemberRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.MemberResponse;
import com.xingchen.oa.office.knowledge.dto.KbDtos.SpaceRequest;
import com.xingchen.oa.office.knowledge.dto.KbDtos.SpaceResponse;
import com.xingchen.oa.office.knowledge.entity.KbDoc;
import com.xingchen.oa.office.knowledge.entity.KbSpace;
import com.xingchen.oa.office.knowledge.entity.KbSpaceMember;
import com.xingchen.oa.office.knowledge.repository.KbDocContentRepository;
import com.xingchen.oa.office.knowledge.repository.KbDocRepository;
import com.xingchen.oa.office.knowledge.repository.KbDocTagRepository;
import com.xingchen.oa.office.knowledge.repository.KbSpaceMemberRepository;
import com.xingchen.oa.office.knowledge.repository.KbSpaceRepository;
import com.xingchen.oa.office.knowledge.support.KbAccess;
import com.xingchen.oa.office.knowledge.support.KbNameResolver;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
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
    private final KbDocTagRepository docTagRepository;
    private final KbAccess access;
    private final KbNameResolver nameResolver;

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
