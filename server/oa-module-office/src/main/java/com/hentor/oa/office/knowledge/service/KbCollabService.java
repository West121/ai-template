package com.hentor.oa.office.knowledge.service;

import com.hentor.oa.office.knowledge.entity.KbDocContent;
import com.hentor.oa.office.knowledge.port.KbCollabPort;
import com.hentor.oa.office.knowledge.repository.KbDocContentRepository;
import com.hentor.oa.office.knowledge.repository.KbDocRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;

/**
 * {@link KbCollabPort} 实现（ai-knowledge-base.md §4 批4b）——协同握手鉴权 + ydoc 持久化。
 *
 * <p>鉴权复用 {@link KbDocService#assertDocEditable(Long)}（依赖 {@code CurrentUserHolder} 已装配）。
 * ydoc 读写只碰 {@code ydoc} 列，与 REST 保存正文（content_json/content_text）互不覆盖。</p>
 */
@Service
@RequiredArgsConstructor
public class KbCollabService implements KbCollabPort {

    private final KbDocService docService;
    private final KbDocRepository docRepository;
    private final KbDocContentRepository contentRepository;

    @Override
    @Transactional(readOnly = true)
    public void assertDocEditable(Long docId) {
        docService.assertDocEditable(docId);
    }

    @Override
    @Transactional(readOnly = true)
    public byte[] loadYdoc(Long docId) {
        return contentRepository.findById(docId).map(KbDocContent::getYdoc).orElse(null);
    }

    @Override
    @Transactional
    public void saveYdoc(Long docId, byte[] ydoc) {
        // 文档已删（房间清空时可能已被级联删）→ 静默 no-op，不留孤儿正文行
        if (docId == null || !docRepository.existsById(docId)) {
            return;
        }
        int updated = contentRepository.updateYdoc(docId, ydoc, OffsetDateTime.now());
        if (updated == 0) {
            // 正文行尚不存在（协同编辑过但从未 REST 保存过）→ 建行只写 ydoc
            KbDocContent content = new KbDocContent();
            content.setDocId(docId);
            content.setYdoc(ydoc);
            content.setUpdatedAt(OffsetDateTime.now());
            contentRepository.save(content);
        }
    }
}
