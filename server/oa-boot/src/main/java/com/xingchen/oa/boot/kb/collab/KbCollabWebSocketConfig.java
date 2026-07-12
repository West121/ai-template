package com.xingchen.oa.boot.kb.collab;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

import java.util.List;

/**
 * 知识库实时协同 WebSocket 装配（ai-knowledge-base.md §4 批4b）。
 *
 * <p>端点 {@code /ws/kb/doc/{docId}}（承载 y-websocket 二进制协议），握手鉴权见
 * {@link KbCollabHandshakeInterceptor}，转发/持久化见 {@link KbCollabHandler}。
 * 允许来源复用 {@code oa.cors.allowed-origins}（与 REST CORS 一致）；token 鉴权不依赖 Cookie，
 * 无 Origin 头的非浏览器客户端（如 y-websocket node/ws）放行。</p>
 */
@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class KbCollabWebSocketConfig implements WebSocketConfigurer {

    private final KbCollabHandler kbCollabHandler;
    private final KbCollabHandshakeInterceptor kbCollabHandshakeInterceptor;

    @Value("${oa.cors.allowed-origins:http://localhost:5173,http://localhost:5181}")
    private List<String> allowedOrigins;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(kbCollabHandler, "/ws/kb/doc/*")
                .addInterceptors(kbCollabHandshakeInterceptor)
                .setAllowedOrigins(allowedOrigins.toArray(String[]::new));
    }

    /**
     * 抬高 WebSocket 二进制缓冲上限——Yjs 全量 update 可超过容器默认 8KB，否则大文档同步会因缓冲溢出断连。
     */
    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxBinaryMessageBufferSize(4 * 1024 * 1024);
        container.setMaxTextMessageBufferSize(512 * 1024);
        return container;
    }
}
