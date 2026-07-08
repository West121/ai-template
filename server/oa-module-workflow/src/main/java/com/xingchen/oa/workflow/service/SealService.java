package com.xingchen.oa.workflow.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.workflow.dto.P3Requests.SealItem;
import com.xingchen.oa.workflow.dto.P3Requests.SealRequest;
import com.xingchen.oa.workflow.entity.WfSeal;
import com.xingchen.oa.workflow.repository.WfSealRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;

/** 电子章管理（P3）：CRUD，引用文件管理的图片 id。imageUrl 由文件下载端点拼装。 */
@Service
@RequiredArgsConstructor
public class SealService {

    private final WfSealRepository repository;

    public List<SealItem> list() {
        return repository.findAllByOrderByIdDesc().stream().map(this::toItem).toList();
    }

    @Transactional
    public SealItem create(SealRequest req) {
        if (!StringUtils.hasText(req.name())) {
            throw new BusinessException(400, "印章名称不能为空");
        }
        WfSeal s = new WfSeal();
        s.setName(req.name());
        s.setImageFileId(req.imageFileId());
        s.setEnabled(req.enabled() == null ? Boolean.TRUE : req.enabled());
        return toItem(repository.save(s));
    }

    @Transactional
    public SealItem update(Long id, SealRequest req) {
        WfSeal s = repository.findById(id).orElseThrow(() -> new BusinessException(404, "印章不存在"));
        if (StringUtils.hasText(req.name())) {
            s.setName(req.name());
        }
        if (req.imageFileId() != null) {
            s.setImageFileId(req.imageFileId());
        }
        if (req.enabled() != null) {
            s.setEnabled(req.enabled());
        }
        return toItem(repository.save(s));
    }

    @Transactional
    public void delete(Long id) {
        if (!repository.existsById(id)) {
            throw new BusinessException(404, "印章不存在");
        }
        repository.deleteById(id);
    }

    private SealItem toItem(WfSeal s) {
        String url = s.getImageFileId() != null
                ? "/api/infra/files/" + s.getImageFileId() + "/download" : null;
        return new SealItem(s.getId(), s.getName(), s.getImageFileId(), url,
                Boolean.TRUE.equals(s.getEnabled()), s.getCreatedAt());
    }
}
