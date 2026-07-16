package com.hentor.oa.office.knowledge.repository;

import com.hentor.oa.office.knowledge.entity.KbSpaceMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface KbSpaceMemberRepository extends JpaRepository<KbSpaceMember, Long> {

    List<KbSpaceMember> findBySpaceIdOrderByIdAsc(Long spaceId);

    List<KbSpaceMember> findBySpaceId(Long spaceId);

    List<KbSpaceMember> findBySpaceIdIn(Collection<Long> spaceIds);

    void deleteBySpaceId(Long spaceId);

    boolean existsBySpaceIdAndPrincipalTypeAndPrincipalId(Long spaceId, String principalType, Long principalId);

    /**
     * 当前用户可见的 PRIVATE / 有成员授权的空间 id 集合：
     * 匹配 (USER=userId) ∪ (DEPT ∈ deptIds) ∪ (ROLE ∈ roleIds)。deptIds/roleIds 为空时传入不可能命中的占位。
     */
    @Query("select distinct m.spaceId from KbSpaceMember m where "
            + "(m.principalType = 'USER' and m.principalId = :userId) "
            + "or (m.principalType = 'DEPT' and m.principalId in :deptIds) "
            + "or (m.principalType = 'ROLE' and m.principalId in :roleIds)")
    List<Long> findSpaceIdsByPrincipals(@Param("userId") Long userId,
                                        @Param("deptIds") Collection<Long> deptIds,
                                        @Param("roleIds") Collection<Long> roleIds);

    /**
     * 当前用户在某空间上匹配到的成员行（用于解析有效空间角色）。
     */
    @Query("select m from KbSpaceMember m where m.spaceId = :spaceId and ("
            + "(m.principalType = 'USER' and m.principalId = :userId) "
            + "or (m.principalType = 'DEPT' and m.principalId in :deptIds) "
            + "or (m.principalType = 'ROLE' and m.principalId in :roleIds))")
    List<KbSpaceMember> findMatchingMembers(@Param("spaceId") Long spaceId,
                                            @Param("userId") Long userId,
                                            @Param("deptIds") Collection<Long> deptIds,
                                            @Param("roleIds") Collection<Long> roleIds);
}
