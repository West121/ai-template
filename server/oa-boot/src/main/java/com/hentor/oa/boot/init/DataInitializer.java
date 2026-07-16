package com.hentor.oa.boot.init;

import com.hentor.oa.system.entity.SysUser;
import com.hentor.oa.system.repository.SysUserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 启动时兜底：Flyway 种子数据里密码列是明文占位（如 admin123），
 * 若发现密码不是 BCrypt（不以 $2 开头）则用 PasswordEncoder 加密后回写，
 * 保证 admin/admin123 一定可登录。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DataInitializer implements CommandLineRunner {

    private final SysUserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    @Override
    @Transactional
    public void run(String... args) {
        List<SysUser> users = userRepository.findAll();
        int updated = 0;
        for (SysUser user : users) {
            String password = user.getPassword();
            if (password == null || !password.startsWith("$2")) {
                String raw = (password == null || password.isBlank()) ? "admin123" : password;
                user.setPassword(passwordEncoder.encode(raw));
                updated++;
            }
        }
        if (updated > 0) {
            userRepository.saveAll(users);
            log.info("DataInitializer: 已将 {} 个用户的明文密码加密为 BCrypt", updated);
        }
    }
}
