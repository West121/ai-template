package com.hentor.oa.office.knowledge.handover;

import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.office.knowledge.entity.KbSpace;
import com.hentor.oa.office.knowledge.entity.KbSpaceMember;
import com.hentor.oa.office.knowledge.repository.KbSpaceMemberRepository;
import com.hentor.oa.office.knowledge.repository.KbSpaceRepository;
import com.hentor.oa.system.entity.SysHandoverItem;
import com.hentor.oa.system.handover.HandoverItemProvider;
import com.hentor.oa.system.handover.HandoverScan;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 知识空间 owner 交接（itemType=KB_SPACE_OWNER，DP2b）：离职人拥有（owner）的知识空间转给继任者，
 * 避免空间变孤儿。执行把 {@code kb_space.owner_id} 改继任者，并把继任者加为该空间 <b>ADMIN 成员</b>（若未在/未达）。
 * 幂等：已是继任者 owner + ADMIN 成员 → no-op。
 *
 * <p>在 office/knowledge 模块实现 system 定义的 {@link HandoverItemProvider} SPI（office 单向依赖 system），
 * {@code HandoverService} 自动纳入扫描/执行，<b>system 不反向依赖 office</b>。历史 applicant/办理记录不动，只转 owner。
 */
@Component
@RequiredArgsConstructor
public class KbSpaceOwnerHandoverProvider implements HandoverItemProvider {

    public static final String TYPE = "KB_SPACE_OWNER";

    private final KbSpaceRepository spaceRepository;
    private final KbSpaceMemberRepository memberRepository;
    private final ObjectMapper objectMapper;

    @Override
    public String itemType() {
        return TYPE;
    }

    @Override
    public List<HandoverScan> scan(Long fromUserId) {
        return spaceRepository.findByOwnerId(fromUserId).stream()
                .map(s -> new HandoverScan("KB_SPACE", String.valueOf(s.getId()),
                        toJson(Map.of("spaceId", s.getId(),
                                "spaceName", s.getName() == null ? "" : s.getName(),
                                "ownerId", fromUserId)),
                        "知识空间 owner：" + s.getName()))
                .toList();
    }

    @Override
    public void execute(SysHandoverItem item, Long successorId) {
        if (successorId == null) {
            throw new BusinessException(400, "知识空间交接需指定继任者");
        }
        Long spaceId = Long.valueOf(item.getRefId());
        KbSpace space = spaceRepository.findById(spaceId)
                .orElseThrow(() -> new BusinessException(404, "知识空间不存在: " + spaceId));
        if (!Objects.equals(space.getOwnerId(), successorId)) {
            space.setOwnerId(successorId);
            spaceRepository.save(space);
        }
        // 继任者加为 ADMIN 成员（未在→新增；已在但非 ADMIN→升级）；幂等
        KbSpaceMember existing = memberRepository.findBySpaceId(spaceId).stream()
                .filter(m -> KbSpaceMember.PRINCIPAL_USER.equals(m.getPrincipalType())
                        && successorId.equals(m.getPrincipalId()))
                .findFirst().orElse(null);
        if (existing == null) {
            KbSpaceMember m = new KbSpaceMember();
            m.setSpaceId(spaceId);
            m.setPrincipalType(KbSpaceMember.PRINCIPAL_USER);
            m.setPrincipalId(successorId);
            m.setRole(KbSpaceMember.ROLE_ADMIN);
            memberRepository.save(m);
        } else if (!KbSpaceMember.ROLE_ADMIN.equals(existing.getRole())) {
            existing.setRole(KbSpaceMember.ROLE_ADMIN);
            memberRepository.save(existing);
        }
    }

    private String toJson(Object v) {
        try {
            return objectMapper.writeValueAsString(v);
        } catch (Exception e) {
            return String.valueOf(v);
        }
    }
}
