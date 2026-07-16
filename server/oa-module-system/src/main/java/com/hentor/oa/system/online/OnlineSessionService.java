package com.hentor.oa.system.online;

import com.hentor.oa.infra.service.RegionService;
import com.hentor.oa.infra.util.IpUtils;
import com.hentor.oa.system.security.OaJwtProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * 在线会话注册表（Redis）+ 踢人（在线用户管理）。
 *
 * <p><b>结构</b>：{@code online:sess:{sid}} 存会话 JSON（TTL=token 余命，活跃滑动续期）；
 * {@code online:sess:index} 为 sid 索引集合（列举用，列举时清理悬挂）；{@code online:touch:{sid}} 为
 * lastActive 更新节流键（60s）。<b>踢人=删会话 key</b> → 该 token 下次请求经 filter 校验为不存在 → 401。
 *
 * <p><b>Redis 降级</b>：注册/续期/踢人失败仅记日志不阻断；<b>会话校验（{@link #isKicked}）Redis 故障 fail-open</b>
 * （返回未踢），避免 Redis 抖动把全站 401 锁死。<b>向后兼容</b>：sessionId 为空（老 token）恒不拒绝。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OnlineSessionService {

    private static final String SESS_PREFIX = "online:sess:";
    private static final String INDEX_KEY = "online:sess:index";
    private static final String TOUCH_PREFIX = "online:touch:";
    private static final Duration TOUCH_THROTTLE = Duration.ofSeconds(60);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final RegionService regionService;
    private final OaJwtProperties jwtProperties;

    // ==================== 注册 / 续期（登录 + switch 调用） ====================

    /**
     * 登录/switch 时建/续会话（同一 sessionId 保持不变；已存在则保留原 loginTime——switch 换身份不算新上线）。
     * ip/ua 取自当前请求，location 复用 ip2region（RegionService）。
     */
    public void register(Long userId, String username, String name, String activeAssignmentId, String sessionId) {
        if (sessionId == null) {
            return;
        }
        String ip = IpUtils.currentIp();
        String ua = IpUtils.currentUserAgent();
        long now = System.currentTimeMillis();
        long loginTime = now;
        try {
            String existing = redis.opsForValue().get(SESS_PREFIX + sessionId);
            if (existing != null) {
                loginTime = objectMapper.readValue(existing, OnlineSession.class).loginTime();
            }
        } catch (Exception ignored) {
            // 读旧会话失败 → 用 now 作为 loginTime
        }
        OnlineSession session = new OnlineSession(sessionId, userId, username, name, ip,
                regionService.resolve(ip), ua, parseClient(ua), loginTime, now, activeAssignmentId);
        store(session, true);
    }

    private void store(OnlineSession session, boolean index) {
        try {
            redis.opsForValue().set(SESS_PREFIX + session.sessionId(), objectMapper.writeValueAsString(session),
                    Duration.ofMinutes(jwtProperties.getExpireMinutes()));
            if (index) {
                redis.opsForSet().add(INDEX_KEY, session.sessionId());
            }
        } catch (Exception e) {
            log.warn("在线会话写入失败(忽略) sid={}: {}", session.sessionId(), e.getMessage());
        }
    }

    // ==================== filter 校验 + 节流续活 ====================

    /** 会话是否已被踢（key 不存在）。老 token（sid=null）恒 false；Redis 故障 fail-open 返回 false（不锁死）。 */
    public boolean isKicked(String sessionId) {
        if (sessionId == null) {
            return false;
        }
        try {
            return !Boolean.TRUE.equals(redis.hasKey(SESS_PREFIX + sessionId));
        } catch (Exception e) {
            log.warn("在线会话校验失败(降级放行) sid={}: {}", sessionId, e.getMessage());
            return false;
        }
    }

    /** 节流更新 lastActive（距上次 >60s 才写，避免每请求写 Redis）+ 滑动续期会话 TTL。 */
    public void touch(String sessionId) {
        if (sessionId == null) {
            return;
        }
        try {
            Boolean fresh = redis.opsForValue().setIfAbsent(TOUCH_PREFIX + sessionId, "1", TOUCH_THROTTLE);
            if (!Boolean.TRUE.equals(fresh)) {
                return; // 60s 内已更新过，节流跳过
            }
            String json = redis.opsForValue().get(SESS_PREFIX + sessionId);
            if (json == null) {
                return;
            }
            OnlineSession s = objectMapper.readValue(json, OnlineSession.class);
            OnlineSession updated = new OnlineSession(s.sessionId(), s.userId(), s.username(), s.name(), s.ip(),
                    s.location(), s.userAgent(), s.client(), s.loginTime(), System.currentTimeMillis(),
                    s.activeAssignmentId());
            store(updated, false);
        } catch (Exception e) {
            log.warn("在线会话 touch 失败(忽略) sid={}: {}", sessionId, e.getMessage());
        }
    }

    // ==================== 列举 / 踢人 ====================

    /** 全部在线会话（按登录时间倒序）；列举时清理悬挂索引（会话已过期/被踢但索引残留）。 */
    public List<OnlineSession> list() {
        List<OnlineSession> out = new ArrayList<>();
        try {
            Set<String> sids = redis.opsForSet().members(INDEX_KEY);
            if (sids == null) {
                return out;
            }
            for (String sid : sids) {
                String json = redis.opsForValue().get(SESS_PREFIX + sid);
                if (json == null) {
                    redis.opsForSet().remove(INDEX_KEY, sid);
                    continue;
                }
                out.add(objectMapper.readValue(json, OnlineSession.class));
            }
        } catch (Exception e) {
            log.warn("在线会话列举失败: {}", e.getMessage());
        }
        out.sort((a, b) -> Long.compare(b.loginTime(), a.loginTime()));
        return out;
    }

    /** 踢下线：删会话 key（该 token 下次请求 401）+ 清索引/节流键。 */
    public boolean kick(String sessionId) {
        try {
            Boolean deleted = redis.delete(SESS_PREFIX + sessionId);
            redis.opsForSet().remove(INDEX_KEY, sessionId);
            redis.delete(TOUCH_PREFIX + sessionId);
            return Boolean.TRUE.equals(deleted);
        } catch (Exception e) {
            log.warn("踢会话失败 sid={}: {}", sessionId, e.getMessage());
            return false;
        }
    }

    /** userAgent 粗解析「浏览器 · 系统」（Edge 含 Chrome，故先判 Edge；Chrome 含 Safari，故 Safari 后判）。 */
    static String parseClient(String ua) {
        if (ua == null || ua.isBlank()) {
            return "未知";
        }
        String browser = ua.contains("Edg") ? "Edge"
                : ua.contains("Chrome") ? "Chrome"
                : ua.contains("Firefox") ? "Firefox"
                : ua.contains("Safari") ? "Safari"
                : "其他浏览器";
        String os = ua.contains("Windows") ? "Windows"
                : (ua.contains("Mac OS") || ua.contains("Macintosh")) ? "macOS"
                : ua.contains("Android") ? "Android"
                : (ua.contains("iPhone") || ua.contains("iPad")) ? "iOS"
                : ua.contains("Linux") ? "Linux"
                : "其他系统";
        return browser + " · " + os;
    }
}
