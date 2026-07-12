package com.xingchen.oa.office.knowledge.repository;

import com.xingchen.oa.office.knowledge.entity.KbSpace;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.List;

public interface KbSpaceRepository extends JpaRepository<KbSpace, Long>, JpaSpecificationExecutor<KbSpace> {

    boolean existsByCode(String code);

    /** 某用户拥有（owner）的知识空间（离职交接 KB_SPACE_OWNER 扫描用）。 */
    List<KbSpace> findByOwnerId(Long ownerId);
}
