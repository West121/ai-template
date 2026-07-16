package com.hentor.oa.boot.ai.service;

import com.hentor.oa.boot.ai.entity.AiFeatureCatalog;
import com.hentor.oa.boot.ai.repository.AiFeatureCatalogRepository;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.UserContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 功能目录服务（批C，§12.1/§10.2）：按用户功能权限过滤可见功能；受控导航校验
 * （featureCode 存在 + 用户可见——navigate 卡由服务端从目录出卡，模型不产任意 path）。
 */
@Service
@RequiredArgsConstructor
public class AiFeatureService {

    private final AiFeatureCatalogRepository repository;

    /** 当前用户可见功能（authorities 全满足；permissions==null 离线 allow-all，与 hasPerm 口径一致）。 */
    public List<AiFeatureCatalog> visibleFor(UserContext user) {
        List<AiFeatureCatalog> out = new ArrayList<>();
        for (AiFeatureCatalog f : repository.findByStatusOrderByIdAsc(AiFeatureCatalog.STATUS_PUBLISHED)) {
            if (isVisible(f, user)) {
                out.add(f);
            }
        }
        return out;
    }

    public boolean isVisible(AiFeatureCatalog f, UserContext user) {
        if (!StringUtils.hasText(f.getRequiredAuthorities())) {
            return true;
        }
        List<String> perms = user.getPermissions();
        if (perms == null) {
            return true; // 离线 allow-all
        }
        for (String a : f.getRequiredAuthorities().split(",")) {
            if (StringUtils.hasText(a) && !perms.contains(a.trim())) {
                return false;
            }
        }
        return true;
    }

    /** 受控导航校验：不存在/停用 → 400；存在但当前用户不可见 → 403。 */
    public AiFeatureCatalog requireVisible(String featureCode, UserContext user) {
        AiFeatureCatalog f = repository.findByFeatureCodeIgnoreCase(
                        featureCode == null ? "" : featureCode.trim())
                .filter(x -> AiFeatureCatalog.STATUS_PUBLISHED.equals(x.getStatus()))
                .orElseThrow(() -> new BusinessException(400, "功能编码不存在: " + featureCode));
        if (!isVisible(f, user)) {
            throw new BusinessException(403, "当前身份不可访问该功能: " + featureCode);
        }
        return f;
    }

    /** featureCode → 名称（pageContext 注入用；未知/不可见返回 null，不抛）。 */
    public AiFeatureCatalog findVisibleOrNull(String featureCode, UserContext user) {
        if (!StringUtils.hasText(featureCode)) {
            return null;
        }
        return repository.findByFeatureCodeIgnoreCase(featureCode.trim())
                .filter(f -> AiFeatureCatalog.STATUS_PUBLISHED.equals(f.getStatus()))
                .filter(f -> isVisible(f, user))
                .orElse(null);
    }

    public Map<String, Object> view(AiFeatureCatalog f) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("featureCode", f.getFeatureCode());
        m.put("moduleCode", f.getModuleCode());
        m.put("name", f.getName());
        m.put("description", f.getDescription());
        m.put("routeCode", f.getRouteCode());
        m.put("keywords", f.getKeywords());
        return m;
    }
}
