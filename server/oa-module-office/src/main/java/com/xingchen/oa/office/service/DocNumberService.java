package com.xingchen.oa.office.service;

import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.office.entity.DocNumberLedger;
import com.xingchen.oa.office.entity.DocNumberRule;
import com.xingchen.oa.office.entity.DocNumberSeq;
import com.xingchen.oa.office.repository.DocNumberLedgerRepository;
import com.xingchen.oa.office.repository.DocNumberRuleRepository;
import com.xingchen.oa.office.repository.DocNumberSeqRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * 文号自动生成 + 台账。
 *
 * <p>占号防跳：{@link #allocate} 在事务内对 {@code oa_doc_number_seq} 用 Postgres
 * {@code INSERT ... ON CONFLICT (rule_id, period) DO UPDATE SET current_seq = current_seq + 1 RETURNING}
 * 原子自增（行锁级别），并发下不跳号、不重号。文号用六角括号〔〕。
 *
 * <p>幂等：同一 documentId 已在台账占过号则直接返回原号（重复签发不再吃号）。
 * 作废：{@link #voidNumber} 只改台账状态为 VOID，<b>不回收</b>序号（台账连续可查）。
 * 预览：{@link #preview} 只读，返回「下一个将是…」，不占号。
 */
@Service
@RequiredArgsConstructor
public class DocNumberService {

    private static final DateTimeFormatter MONTH_FMT = DateTimeFormatter.ofPattern("yyyy-MM");

    private final DocNumberRuleRepository ruleRepository;
    private final DocNumberSeqRepository seqRepository;
    private final DocNumberLedgerRepository ledgerRepository;

    @PersistenceContext
    private EntityManager entityManager;

    public List<DocNumberRule> enabledRules() {
        return ruleRepository.findByEnabledTrueOrderByIdAsc();
    }

    /** 解析规则：优先指定 ruleId；否则按文种匹配（精确文种 > 通配），再退回首个启用规则。 */
    public DocNumberRule resolveRule(Long ruleId, String docType) {
        if (ruleId != null) {
            return ruleRepository.findById(ruleId)
                    .orElseThrow(() -> new BusinessException(404, "文号规则不存在"));
        }
        List<DocNumberRule> rules = ruleRepository.findByEnabledTrueOrderByIdAsc();
        if (rules.isEmpty()) {
            throw new BusinessException(400, "未配置任何启用的文号规则");
        }
        DocNumberRule wildcard = null;
        for (DocNumberRule r : rules) {
            if (StringUtils.hasText(docType) && docType.equals(r.getDocType())) {
                return r;
            }
            if (r.getDocType() == null && wildcard == null) {
                wildcard = r;
            }
        }
        return wildcard != null ? wildcard : rules.get(0);
    }

    /** 预览下一个文号（不占号）。 */
    public String preview(Long ruleId, String docType) {
        DocNumberRule rule = resolveRule(ruleId, docType);
        String period = period(rule);
        int next = seqRepository.findByRuleIdAndPeriod(rule.getId(), period)
                .map(DocNumberSeq::getCurrentSeq).orElse(0) + 1;
        return compose(rule, period, next);
    }

    /**
     * 正式占号（签发通过节点调用）。幂等：documentId 已占号则返回原号。
     *
     * @return 组装好的文号（含六角括号）
     */
    @Transactional
    public String allocate(Long ruleId, String docType, Long documentId, String docTitle, String issuer) {
        // 幂等：同一公文已占号则直接返回
        DocNumberLedger existing = ledgerRepository.findFirstByDocumentIdOrderByIdAsc(documentId).orElse(null);
        if (existing != null) {
            return existing.getDocNumber();
        }
        DocNumberRule rule = resolveRule(ruleId, docType);
        String period = period(rule);
        int seq = nextSeqAtomic(rule.getId(), period);
        String number = compose(rule, period, seq);

        DocNumberLedger ledger = new DocNumberLedger();
        ledger.setDocNumber(number);
        ledger.setRuleId(rule.getId());
        ledger.setDocumentId(documentId);
        ledger.setDocTitle(docTitle);
        ledger.setIssuer(issuer);
        ledger.setStatus(DocNumberLedger.STATUS_OCCUPIED);
        ledgerRepository.save(ledger);
        return number;
    }

    /** 作废文号：只改台账状态 VOID，不回收序号。 */
    @Transactional
    public void voidNumber(String docNumber) {
        DocNumberLedger ledger = ledgerRepository.findByDocNumber(docNumber)
                .orElseThrow(() -> new BusinessException(404, "文号不存在于台账"));
        ledger.setStatus(DocNumberLedger.STATUS_VOID);
        ledgerRepository.save(ledger);
    }

    /**
     * 原子自增当前周期序号并返回新值。Postgres UPSERT + RETURNING，行锁级并发安全。
     */
    private int nextSeqAtomic(Long ruleId, String period) {
        Object result = entityManager.createNativeQuery(
                        "INSERT INTO oa_doc_number_seq (rule_id, period, current_seq, version) "
                                + "VALUES (:ruleId, :period, 1, 0) "
                                + "ON CONFLICT (rule_id, period) "
                                + "DO UPDATE SET current_seq = oa_doc_number_seq.current_seq + 1 "
                                + "RETURNING current_seq")
                .setParameter("ruleId", ruleId)
                .setParameter("period", period)
                .getSingleResult();
        return ((Number) result).intValue();
    }

    private String period(DocNumberRule rule) {
        LocalDate now = LocalDate.now();
        return switch (rule.getSeqScope()) {
            case DocNumberRule.SCOPE_MONTH -> now.format(MONTH_FMT);
            case DocNumberRule.SCOPE_NONE -> "ALL";
            default -> String.valueOf(now.getYear());
        };
    }

    private String compose(DocNumberRule rule, String period, int seq) {
        int width = rule.getSeqWidth() == null ? 1 : rule.getSeqWidth();
        String seqStr = width > 1 ? String.format("%0" + width + "d", seq) : String.valueOf(seq);
        LocalDate now = LocalDate.now();
        return rule.getPattern()
                .replace("{org}", rule.getOrgCode())
                .replace("{year}", String.valueOf(now.getYear()))
                .replace("{month}", String.format("%02d", now.getMonthValue()))
                .replace("{seq}", seqStr);
    }
}
