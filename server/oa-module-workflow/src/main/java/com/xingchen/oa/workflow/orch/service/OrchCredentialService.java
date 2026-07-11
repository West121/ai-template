package com.xingchen.oa.workflow.orch.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.CredentialRequest;
import com.xingchen.oa.workflow.orch.dto.OrchDtos.CredentialResponse;
import com.xingchen.oa.workflow.orch.engine.OrchCipher;
import com.xingchen.oa.workflow.orch.entity.OrchCredential;
import com.xingchen.oa.workflow.orch.repository.OrchCredentialRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.Comparator;
import java.util.List;

/** 编排凭据 CRUD：api_key AES-GCM 加密存储，只写不回显。 */
@Service
@RequiredArgsConstructor
public class OrchCredentialService {

    private final OrchCredentialRepository repository;
    private final OrchCipher cipher;

    public List<CredentialResponse> list() {
        return repository.findAll().stream()
                .sorted(Comparator.comparing(OrchCredential::getId))
                .map(this::toResponse).toList();
    }

    @Transactional
    public CredentialResponse create(CredentialRequest req) {
        if (!StringUtils.hasText(req.name())) {
            throw new BusinessException(400, "凭据名称不能为空");
        }
        OrchCredential c = new OrchCredential();
        apply(c, req);
        return toResponse(repository.save(c));
    }

    @Transactional
    public CredentialResponse update(Long id, CredentialRequest req) {
        OrchCredential c = repository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "凭据不存在"));
        apply(c, req);
        return toResponse(repository.save(c));
    }

    @Transactional
    public void delete(Long id) {
        repository.deleteById(id);
    }

    private void apply(OrchCredential c, CredentialRequest req) {
        if (StringUtils.hasText(req.name())) {
            c.setName(req.name());
        }
        if (StringUtils.hasText(req.type())) {
            c.setType(req.type().toUpperCase());
        }
        c.setBaseUrl(req.baseUrl());
        c.setModel(req.model());
        c.setHeaderName(req.headerName());
        if (req.enabled() != null) {
            c.setEnabled(req.enabled());
        }
        if (req.supportsVision() != null) {
            c.setSupportsVision(req.supportsVision());
        }
        if (StringUtils.hasText(req.apiKey())) {
            c.setApiKeyEnc(cipher.encrypt(req.apiKey())); // 只写：留空不改
        }
    }

    private CredentialResponse toResponse(OrchCredential c) {
        return new CredentialResponse(c.getId(), c.getName(), c.getType(), c.getBaseUrl(),
                c.getModel(), c.getHeaderName(), c.getEnabled(), c.getSupportsVision(),
                StringUtils.hasText(c.getApiKeyEnc()), c.getCreatedAt());
    }
}
