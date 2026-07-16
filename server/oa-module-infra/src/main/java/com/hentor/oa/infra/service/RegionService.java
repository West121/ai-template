package com.hentor.oa.infra.service;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.lionsoul.ip2region.xdb.Searcher;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * IP 归属地解析：ip2region v2 离线库（classpath:ip2region/ip2region.xdb）
 * 启动时整库读入内存（Searcher.newWithBuffer，微秒级查询；官方说明：
 * 基于整个 xdb 缓存创建的查询对象可安全并发使用）。
 * <p>内网地址 → "内网"；"国家|区域|省份|城市|ISP" → "省份城市"（如 "广东省广州市"，
 * 纯国外 → "国家 城市"）；任何异常兜底 "未知"。
 */
@Slf4j
@com.hentor.oa.common.script.ScriptApi("IP 归属地解析（ip2region 离线库）：resolve(ip) → 省份城市/内网/未知")
@Service
public class RegionService {

    private static final String UNKNOWN = "未知";
    private static final String INTERNAL = "内网";

    private Searcher searcher;

    @PostConstruct
    void init() {
        try {
            byte[] bytes = new ClassPathResource("ip2region/ip2region.xdb").getInputStream().readAllBytes();
            searcher = Searcher.newWithBuffer(bytes);
            log.info("ip2region 离线库加载完成（{} KB，全内存模式）", bytes.length / 1024);
        } catch (Exception e) {
            // 库缺失/损坏不阻断应用启动，resolve 统一兜底 "未知"
            log.warn("ip2region 离线库加载失败，IP 归属地将返回 \"未知\": {}", e.getMessage());
        }
    }

    public String resolve(String ip) {
        if (!StringUtils.hasText(ip)) {
            return UNKNOWN;
        }
        if (isInternal(ip)) {
            return INTERNAL;
        }
        if (searcher == null) {
            return UNKNOWN;
        }
        try {
            // 格式：国家|区域|省份|城市|ISP，缺失段为 "0"
            String region = searcher.search(ip.trim());
            return format(region);
        } catch (Exception e) {
            return UNKNOWN;
        }
    }

    private String format(String region) {
        if (!StringUtils.hasText(region)) {
            return UNKNOWN;
        }
        String[] parts = region.split("\\|", -1);
        String country = clean(parts.length > 0 ? parts[0] : "");
        String province = clean(parts.length > 2 ? parts[2] : "");
        String city = clean(parts.length > 3 ? parts[3] : "");
        if ("内网IP".equals(country) || "内网IP".equals(city)) {
            return INTERNAL;
        }
        if (country.isEmpty() && province.isEmpty() && city.isEmpty()) {
            return UNKNOWN;
        }
        if ("中国".equals(country)) {
            // 组装 "省份城市"，去掉 0 与重复（直辖市省=市）
            String result = city.equals(province) ? province : province + city;
            return result.isEmpty() ? country : result;
        }
        // 纯国外："国家 城市"
        return city.isEmpty() ? country : country + " " + city;
    }

    private String clean(String part) {
        return part == null || "0".equals(part.trim()) ? "" : part.trim();
    }

    private boolean isInternal(String ip) {
        String v = ip.trim();
        if ("localhost".equalsIgnoreCase(v) || "::1".equals(v) || "0:0:0:0:0:0:0:1".equals(v)) {
            return true;
        }
        if (v.startsWith("127.") || v.startsWith("10.") || v.startsWith("192.168.")) {
            return true;
        }
        if (v.startsWith("172.")) {
            String[] octets = v.split("\\.");
            if (octets.length > 1) {
                try {
                    int second = Integer.parseInt(octets[1]);
                    return second >= 16 && second <= 31;
                } catch (NumberFormatException ignored) {
                    return false;
                }
            }
        }
        return false;
    }
}
