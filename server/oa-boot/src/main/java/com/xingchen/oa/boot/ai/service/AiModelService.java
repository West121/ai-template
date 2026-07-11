package com.xingchen.oa.boot.ai.service;

import com.xingchen.oa.boot.ai.entity.AiModelProfile;
import com.xingchen.oa.boot.ai.repository.AiModelProfileRepository;
import com.xingchen.oa.boot.ai.support.AiErrors;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.orch.engine.OrchCipher;
import com.xingchen.oa.workflow.orch.entity.OrchCredential;
import com.xingchen.oa.workflow.orch.repository.OrchCredentialRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 模型档案服务（§4.3，批B）：modelProfileId(code) → orch_credential 映射与解析。
 * 凭据/供应商/密钥永不出 API（profiles 列表只回 code/name/available/supportsVision）。
 *
 * <p>解析优先级（兼容期）：请求 credentialId（V1 显式凭据，兼容保留）→ modelProfileId →
 * 系统默认凭据（V1 规则：ai-assistant.credential-id 配置，否则最新一条启用 LLM 凭据）——
 * 未显式选择时不自动落到 STANDARD 档案，保持 V1 行为兼容（前端切换后默认传 STANDARD）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiModelService {

    private final AiModelProfileRepository profileRepository;
    private final OrchCredentialRepository credentialRepository;
    private final OrchCipher cipher;

    /** 系统默认 LLM 凭据：配置指定，否则取最新一条启用 LLM 凭据（V1 口径）。 */
    @Value("${ai-assistant.credential-id:0}")
    private long configuredCredentialId;

    /** 解析结果：凭据 + 已解密 key + 生效模型名。 */
    public record ResolvedModel(OrchCredential credential, String apiKey, String model) {
    }

    /** GET /api/ai/model-profiles：档案列表（无凭据细节；available=映射凭据可用）。 */
    public List<Map<String, Object>> profiles() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (AiModelProfile p : profileRepository.findByEnabledTrueOrderBySortNoAscIdAsc()) {
            OrchCredential cred = p.getCredentialId() == null ? null
                    : credentialRepository.findById(p.getCredentialId()).orElse(null);
            boolean available = cred != null && Boolean.TRUE.equals(cred.getEnabled())
                    && StringUtils.hasText(cred.getBaseUrl());
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", p.getId());
            m.put("code", p.getCode());
            m.put("name", p.getName());
            m.put("description", p.getDescription());
            m.put("available", available);
            m.put("supportsVision", cred != null && Boolean.TRUE.equals(cred.getSupportsVision()));
            out.add(m);
        }
        return out;
    }

    /**
     * 解析生效模型：credentialId（V1 兼容）→ modelProfileId → 系统默认；modelOverride 最后覆盖模型名。
     * 解密失败 → 503 AI_MODEL_UNAVAILABLE（明确错误，不再 500 空 body）。
     * @return null = 系统未配置任何 LLM 凭据（上游走引导文案，V1 行为）
     */
    public ResolvedModel resolve(Long credentialId, String modelProfileId, String modelOverride) {
        OrchCredential cred;
        String profileModel = null;
        if (credentialId != null) {
            cred = requireLlmCredential(credentialId);
        } else if (StringUtils.hasText(modelProfileId)) {
            AiModelProfile profile = profileRepository.findByCodeIgnoreCase(modelProfileId.trim())
                    .orElseThrow(() -> AiErrors.e(400, AiErrors.MODEL_NOT_ALLOWED,
                            "模型档案不存在: " + modelProfileId));
            if (!Boolean.TRUE.equals(profile.getEnabled()) || profile.getCredentialId() == null) {
                throw AiErrors.e(503, AiErrors.MODEL_UNAVAILABLE,
                        "模型档案未配置或已停用: " + profile.getCode());
            }
            cred = credentialRepository.findById(profile.getCredentialId()).orElse(null);
            if (cred == null || !Boolean.TRUE.equals(cred.getEnabled()) || !StringUtils.hasText(cred.getBaseUrl())) {
                throw AiErrors.e(503, AiErrors.MODEL_UNAVAILABLE,
                        "模型档案映射的凭据不可用: " + profile.getCode());
            }
            profileModel = profile.getModelOverride();
        } else {
            cred = defaultCredential();
            if (cred == null) {
                return null; // 未配置任何 LLM 凭据（V1 引导文案路径）
            }
        }
        String apiKey;
        try {
            apiKey = cipher.decrypt(cred.getApiKeyEnc());
        } catch (Exception e) {
            log.warn("LLM 凭据解密失败 credential={}: {}", cred.getId(), e.getMessage());
            throw AiErrors.e(503, AiErrors.MODEL_UNAVAILABLE,
                    "模型凭据不可用（解密失败），请联系管理员重新配置密钥");
        }
        String model = StringUtils.hasText(modelOverride) ? modelOverride
                : (StringUtils.hasText(profileModel) ? profileModel : cred.getModel());
        return new ResolvedModel(cred, apiKey, model);
    }

    private OrchCredential requireLlmCredential(Long id) {
        OrchCredential c = credentialRepository.findById(id)
                .orElseThrow(() -> new BusinessException(400, "凭据不存在: " + id));
        if (!OrchCredential.TYPE_LLM.equals(c.getType())) {
            throw new BusinessException(400, "凭据不是 LLM 型: " + c.getName());
        }
        if (!Boolean.TRUE.equals(c.getEnabled())) {
            throw new BusinessException(400, "凭据已停用: " + c.getName());
        }
        return c;
    }

    private OrchCredential defaultCredential() {
        if (configuredCredentialId > 0) {
            OrchCredential c = credentialRepository.findById(configuredCredentialId).orElse(null);
            if (c != null && Boolean.TRUE.equals(c.getEnabled())) {
                return c;
            }
        }
        return credentialRepository.findAll().stream()
                .filter(c -> OrchCredential.TYPE_LLM.equals(c.getType()) && Boolean.TRUE.equals(c.getEnabled())
                        && StringUtils.hasText(c.getBaseUrl()))
                .max(java.util.Comparator.comparing(OrchCredential::getId)).orElse(null);
    }
}
