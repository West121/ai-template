package com.xingchen.oa.boot.config;

import com.xingchen.oa.boot.security.JwtAuthFilter;
import jakarta.servlet.DispatcherType;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * Spring Security 7（Boot 4）lambda DSL 安全配置。
 * @EnableMethodSecurity 开启 @PreAuthorize 方法级鉴权（authorities = 权限点 code）。
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthFilter jwtAuthFilter;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(Customizer.withDefaults())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // B-18：放行 ERROR 派发。否则匿名/出错请求向 /error 二次派发时会被再次鉴权拒绝，
                        // 而此时 401 响应已写出 → "response already committed" → 连接被重置（keep-alive 复用后表现为 socket closed）。
                        // AI-V2 批A：放行 ASYNC 派发。SseEmitter 完成时容器做 ASYNC 二次派发，该派发无认证上下文
                        // （JwtAuthFilter shouldNotFilterAsyncDispatch）→ 被拒则 chunked 流不写终止块，客户端报 socket closed。
                        // REQUEST 首次派发已完成鉴权，ASYNC 派发放行不构成越权面（Spring Security 官方口径）。
                        .dispatcherTypeMatchers(DispatcherType.ERROR, DispatcherType.ASYNC).permitAll()
                        .requestMatchers(
                                "/api/auth/login",
                                "/swagger-ui/**",
                                "/swagger-ui.html",
                                "/v3/api-docs/**",
                                "/actuator/health",
                                // 编排 Webhook 入站 / wait 恢复回调：免登录，token 鉴权 + 限流护栏在 OrchHookController
                                "/api/orch/hooks/*",
                                "/api/orch/resume/*"
                        ).permitAll()
                        .anyRequest().authenticated()
                )
                // 未认证统一返回 401（默认是 403），前端据此触发重新登录
                .exceptionHandling(ex -> ex.authenticationEntryPoint((request, response, e) -> {
                    response.setStatus(401);
                    response.setContentType("application/json;charset=UTF-8");
                    response.getWriter().write("{\"code\":401,\"message\":\"未登录或凭证已失效\",\"data\":null}");
                }))
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
