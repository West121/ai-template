package com.xingchen.oa.workflow.support;

import com.xingchen.oa.system.entity.SysUser;
import com.xingchen.oa.system.repository.SysUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.stream.Collectors;

/** 用户 id → 姓名 解析。 */
@Component
@RequiredArgsConstructor
public class UserNameResolver {

    private final SysUserRepository userRepository;

    public Map<Long, String> nameMap() {
        return userRepository.findAll().stream()
                .collect(Collectors.toMap(SysUser::getId, SysUser::getName, (a, b) -> a));
    }

    public String name(Long userId) {
        if (userId == null) {
            return null;
        }
        return userRepository.findById(userId).map(SysUser::getName).orElse(null);
    }

    public String nameOf(String userId) {
        if (userId == null || userId.isBlank()) {
            return userId;
        }
        try {
            return name(Long.parseLong(userId.trim()));
        } catch (NumberFormatException e) {
            return userId;
        }
    }
}
