package com.hentor.oa.office.service;

import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.common.security.UserContext;
import com.hentor.oa.office.dto.DocumentCreateRequest;
import com.hentor.oa.office.dto.DocumentResponse;
import com.hentor.oa.office.entity.Document;
import com.hentor.oa.office.repository.DocumentRepository;
import com.hentor.oa.office.support.DeptNameResolver;
import com.hentor.oa.office.support.DataScopeSupport;
import com.hentor.oa.office.support.SecuritySupport;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class DocumentService {

    private final DocumentRepository documentRepository;
    private final DeptNameResolver deptNameResolver;
    private final DataScopeSupport dataScopeSupport;

    public PageResult<DocumentResponse> page(String direction, String status, String keyword, int pageNum, int pageSize) {
        Specification<Document> condition = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (StringUtils.hasText(direction)) {
                predicates.add(cb.equal(root.get("direction"), direction));
            }
            if (StringUtils.hasText(status)) {
                predicates.add(cb.equal(root.get("status"), status));
            }
            if (StringUtils.hasText(keyword)) {
                String like = "%" + keyword.trim() + "%";
                predicates.add(cb.or(cb.like(root.get("title"), like), cb.like(root.get("code"), like)));
            }
            return cb.and(predicates.toArray(new Predicate[0]));
        };
        Page<Document> page = documentRepository.findAll(
                condition.and(dataScopeSupport.multiDim(documentFeature(direction), "Document", "deptId", "creatorId")), // V54 功能级接入
                PageRequest.of(Math.max(pageNum - 1, 0), pageSize, Sort.by(Sort.Direction.DESC, "createdAt")));
        Map<Long, String> deptNames = deptNameResolver.nameMap();
        List<DocumentResponse> list = page.getContent().stream()
                .map(d -> toResponse(d, deptNames))
                .toList();
        return new PageResult<>(list, page.getTotalElements(), page.getNumber() + 1, page.getSize());
    }

    /**
     * 新建发文：code 自动生成「涵发〔yyyy〕N号」，status = DRAFT。
     */
    @Transactional
    public DocumentResponse create(DocumentCreateRequest request) {
        UserContext context = SecuritySupport.currentUser();
        Document document = new Document();
        document.setDirection(Document.DIRECTION_SEND);
        document.setCode("涵发〔" + LocalDate.now().getYear() + "〕"
                + (documentRepository.countByDirection(Document.DIRECTION_SEND) + 1) + "号");
        document.setTitle(request.title());
        document.setUnit(request.unit());
        document.setSecret(request.secret());
        document.setUrgency(request.urgency());
        document.setContent(request.content());
        document.setStatus(Document.STATUS_DRAFT);
        document.setDrafter(SecuritySupport.displayName(context));
        document.setDocDate(LocalDate.now());
        document.setDeptId(context.getActiveDeptId());
        document.setCreatorId(context.getUserId());
        return toResponse(documentRepository.save(document), deptNameResolver.nameMap());
    }

    /**
     * 收文签收：待签收 → 办理中。
     */
    @Transactional
    public DocumentResponse sign(Long id) {
        return transition(id, Document.DIRECTION_RECEIVE, Document.STATUS_TO_SIGN,
                Document.STATUS_PROCESSING, "仅待签收的收文可签收", null);
    }

    /**
     * 收文办结：办理中 → 已办结。
     */
    @Transactional
    public DocumentResponse finish(Long id) {
        return transition(id, Document.DIRECTION_RECEIVE, Document.STATUS_PROCESSING,
                Document.STATUS_FINISHED, "仅办理中的收文可办结", null);
    }

    /**
     * 发文提交核稿：拟稿 → 核稿中。
     */
    @Transactional
    public DocumentResponse review(Long id) {
        return transition(id, Document.DIRECTION_SEND, Document.STATUS_DRAFT,
                Document.STATUS_REVIEWING, "仅拟稿状态的发文可提交核稿", null);
    }

    /**
     * 发文签发：核稿中 → 已签发，签发人为当前用户。
     */
    @Transactional
    public DocumentResponse issue(Long id) {
        return transition(id, Document.DIRECTION_SEND, Document.STATUS_REVIEWING,
                Document.STATUS_ISSUED, "仅核稿中的发文可签发",
                SecuritySupport.displayName(SecuritySupport.currentUser()));
    }

    @Transactional
    public void delete(Long id) {
        Document document = documentRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "公文不存在"));
        documentRepository.delete(document);
    }

    private DocumentResponse transition(Long id, String direction, String fromStatus,
                                        String toStatus, String errorMessage, String signer) {
        Document document = documentRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "公文不存在"));
        if (!direction.equals(document.getDirection()) || !fromStatus.equals(document.getStatus())) {
            throw new BusinessException(400, errorMessage);
        }
        document.setStatus(toStatus);
        if (signer != null) {
            document.setSigner(signer);
        }
        return toResponse(documentRepository.save(document), deptNameResolver.nameMap());
    }

    /** V54 功能键：公文页按方向分键（发文/收文），无方向=台账视图。 */
    private String documentFeature(String direction) {
        if (Document.DIRECTION_SEND.equals(direction)) {
            return "DOCUMENT_SEND";
        }
        if (Document.DIRECTION_RECEIVE.equals(direction)) {
            return "DOCUMENT_RECEIVE";
        }
        return "DOCUMENT_LEDGER";
    }

    private DocumentResponse toResponse(Document d, Map<Long, String> deptNames) {
        return new DocumentResponse(
                d.getId(), d.getDirection(), d.getCode(), d.getTitle(), d.getUnit(),
                d.getSecret(), d.getUrgency(), d.getStatus(), d.getDrafter(), d.getSigner(),
                d.getContent(), d.getDocDate(), d.getDeptId(),
                d.getDeptId() != null ? deptNames.get(d.getDeptId()) : null,
                d.getCreatedAt());
    }
}
