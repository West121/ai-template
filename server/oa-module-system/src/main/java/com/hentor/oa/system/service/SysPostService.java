package com.hentor.oa.system.service;

import com.hentor.oa.common.core.BatchResult;
import com.hentor.oa.common.core.PageResult;
import com.hentor.oa.common.exception.BusinessException;
import com.hentor.oa.system.dto.PostRequest;
import com.hentor.oa.system.dto.PostResponse;
import com.hentor.oa.system.entity.SysPost;
import com.hentor.oa.system.repository.SysPostRepository;
import com.hentor.oa.system.repository.SysUserAssignmentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;

/**
 * 岗位管理。
 */
@Service
@RequiredArgsConstructor
public class SysPostService {

    private final SysPostRepository postRepository;
    private final SysUserAssignmentRepository assignmentRepository;

    @Transactional(readOnly = true)
    public PageResult<PostResponse> page(String keyword, int pageNum, int pageSize) {
        Pageable pageable = PageRequest.of(Math.max(pageNum - 1, 0), pageSize,
                Sort.by(Sort.Order.asc("sort"), Sort.Order.asc("id")));
        Page<SysPost> page = StringUtils.hasText(keyword)
                ? postRepository.findByNameContainingOrCodeContaining(keyword, keyword, pageable)
                : postRepository.findAll(pageable);
        return PageResult.from(page.map(post ->
                PostResponse.of(post, assignmentRepository.countByPostId(post.getId()))));
    }

    @Transactional
    public PostResponse create(PostRequest request) {
        if (postRepository.existsByCode(request.code())) {
            throw new BusinessException(400, "岗位编码已存在");
        }
        SysPost post = new SysPost();
        post.setCode(request.code());
        post.setName(request.name());
        post.setSort(request.sort());
        postRepository.save(post);
        return PostResponse.of(post, 0);
    }

    @Transactional
    public PostResponse update(Long id, PostRequest request) {
        SysPost post = postRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "岗位不存在"));
        if (postRepository.existsByCodeAndIdNot(request.code(), id)) {
            throw new BusinessException(400, "岗位编码已存在");
        }
        post.setCode(request.code());
        post.setName(request.name());
        post.setSort(request.sort());
        postRepository.save(post);
        return PostResponse.of(post, assignmentRepository.countByPostId(id));
    }

    @Transactional
    public void delete(Long id) {
        SysPost post = postRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "岗位不存在"));
        if (assignmentRepository.countByPostId(id) > 0) {
            throw new BusinessException(400, "岗位下存在任职人员，无法删除");
        }
        postRepository.delete(post);
    }

    /**
     * 批量删除岗位（统一协议）。护栏：岗位下存在任职人员不可删（计 failed）。幂等：已不存在计 success。
     */
    @Transactional
    public BatchResult batchDelete(List<Long> ids) {
        BatchResult result = new BatchResult();
        List<Long> targets = ids == null ? List.of()
                : ids.stream().filter(java.util.Objects::nonNull).distinct().toList();
        for (Long id : targets) {
            var postOpt = postRepository.findById(id);
            if (postOpt.isEmpty()) {
                result.success(id); // 幂等
                continue;
            }
            if (assignmentRepository.countByPostId(id) > 0) {
                result.fail(id, "岗位下存在任职人员，无法删除");
                continue;
            }
            postRepository.delete(postOpt.get());
            result.success(id);
        }
        return result;
    }
}
