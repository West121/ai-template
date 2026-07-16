package com.hentor.oa.boot.ai.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 权限解释器（亮点②，附3 批B）：工具 403 时给出结构化解释——缺失权限码 + 哪些角色持有该权限 +
 * 申请引导，assembler 产 error part 前端渲染申请引导卡。只读 sys_* 元数据，不含任何越权信息。
 */
@Slf4j
@Service
public class AiPermissionExplainer {

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * 结构化 403 解释：{missingAuthority, missingAuthorityName, holderRoles[], adminHint}。
     * 查询失败降级为仅 missingAuthority（不阻断错误反馈）。
     */
    public Map<String, Object> explain(String missingAuthority) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("missingAuthority", missingAuthority);
        try {
            List<?> nameRows = entityManager.createNativeQuery(
                            "SELECT name FROM sys_permission WHERE code = :code")
                    .setParameter("code", missingAuthority).getResultList();
            if (!nameRows.isEmpty()) {
                out.put("missingAuthorityName", String.valueOf(nameRows.get(0)));
            }
            List<?> roleRows = entityManager.createNativeQuery(
                            "SELECT r.name FROM sys_role r "
                                    + "JOIN sys_role_permission rp ON rp.role_id = r.id "
                                    + "JOIN sys_permission p ON p.id = rp.permission_id "
                                    + "WHERE p.code = :code AND r.enabled ORDER BY r.sort")
                    .setParameter("code", missingAuthority).getResultList();
            List<String> holderRoles = new ArrayList<>();
            for (Object r : roleRows) {
                holderRoles.add(String.valueOf(r));
            }
            out.put("holderRoles", holderRoles);
        } catch (Exception e) {
            log.warn("权限解释查询失败（降级为仅权限码）: {}", e.getMessage());
            out.put("holderRoles", List.of());
        }
        out.put("adminHint", "如需此能力，请联系管理员在「系统管理-角色管理」为你的角色授予该权限，"
                + "或切换到具备权限的任职身份后重试。");
        return out;
    }
}
