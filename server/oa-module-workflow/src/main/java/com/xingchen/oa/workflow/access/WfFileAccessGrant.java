package com.xingchen.oa.workflow.access;

import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.infra.access.FileAccessGrant;
import com.xingchen.oa.workflow.repository.WfCcRepository;
import com.xingchen.oa.workflow.repository.WfInstanceExtRepository;
import com.xingchen.oa.workflow.repository.WfOperationRepository;
import com.xingchen.oa.workflow.repository.WfSealRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 工作流侧文件下载附加放行（B-17，实现 infra 的 {@link FileAccessGrant} SPI）。
 *
 * <p>在 B-04 收紧下载后，补齐两类「用户可合法查看的业务对象所引用的文件」：
 * <ol>
 *   <li><b>电子章图片</b>：印章是组织级、登录可见的资产（{@code GET /api/wf/seals} 对所有登录用户返回 imageUrl），
 *       故文件被任一 {@code wf_seal.image_file_id} 引用时，放行任意登录用户。完全消除 instance-detail / wf-print 裂图。</li>
 *   <li><b>审批操作附件</b>（{@code POST tasks/{id}/approve|reject} 的 {@code attachments:[fileId]}，
 *       存于 {@code wf_operation.detail_json} 的 {@code attachments} 数组）：当文件被
 *       「当前用户可见的实例」（其发起 / 曾办理 / 被抄送）的某条操作引用时放行。</li>
 * </ol>
 *
 * <p><b>未覆盖（TODO）</b>：表单内「文件/图片上传」控件产生、存于 {@code wf_instance_ext.form_data_json} 的文件，
 * 其结构随表单 schema 而定（可能是标量 / 数组 / 对象），可靠反查需要在写入时建立
 * 文件↔实例的显式关联表（file_ref），成本较高，留待后续（见报告 TODO）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WfFileAccessGrant implements FileAccessGrant {

    private final WfSealRepository sealRepository;
    private final WfInstanceExtRepository instanceRepository;
    private final WfOperationRepository operationRepository;
    private final WfCcRepository ccRepository;
    private final ObjectMapper objectMapper;

    @Override
    public boolean canRead(Long fileId, UserContext user) {
        if (fileId == null || user == null || user.getUserId() == null) {
            return false;
        }
        // 1) 电子章：组织级登录可见资产，放行任意登录用户
        if (sealRepository.existsByImageFileId(fileId)) {
            return true;
        }
        // 2) 审批操作附件：被当前用户可见实例的操作引用
        return referencedByVisibleOperation(fileId, user.getUserId());
    }

    /** 文件是否被「当前用户可见实例」（发起/办理/抄送）的某条操作 attachments 引用。 */
    private boolean referencedByVisibleOperation(Long fileId, Long userId) {
        Set<String> pids = new HashSet<>();
        pids.addAll(instanceRepository.findProcInstIdsByInitiatorId(userId));
        pids.addAll(operationRepository.findDistinctProcInstIdByActorId(userId));
        pids.addAll(ccRepository.findProcInstIdsByUserId(userId));
        if (pids.isEmpty()) {
            return false;
        }
        for (String detailJson : operationRepository.findDetailJsonByProcInstIds(pids)) {
            if (attachmentsContain(detailJson, fileId)) {
                return true;
            }
        }
        return false;
    }

    /** 解析操作明细 {@code {"attachments":[id,...]}}，判断是否含目标 fileId。 */
    private boolean attachmentsContain(String detailJson, Long fileId) {
        if (detailJson == null || detailJson.isBlank()) {
            return false;
        }
        try {
            JsonNode node = objectMapper.readTree(detailJson);
            JsonNode arr = node.path("attachments");
            if (arr.isArray()) {
                for (JsonNode a : arr) {
                    if (a.isNumber() && a.asLong() == fileId) {
                        return true;
                    }
                    if (a.isTextual() && String.valueOf(fileId).equals(a.asString())) {
                        return true;
                    }
                }
            }
        } catch (Exception e) {
            log.debug("解析操作附件明细失败 file={}: {}", fileId, e.getMessage());
        }
        return false;
    }
}
