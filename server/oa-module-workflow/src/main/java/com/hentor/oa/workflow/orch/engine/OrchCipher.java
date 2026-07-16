package com.hentor.oa.workflow.orch.engine;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * 凭据加密（AES-256-GCM）：密钥 = SHA-256(OA_CRED_SECRET，缺省回退 OA_JWT_SECRET)。
 * 密文格式 Base64(iv(12B) + ciphertext)。designer_json / API 一律不落明文 key。
 */
@Slf4j
@Component
public class OrchCipher {

    private static final SecureRandom RANDOM = new SecureRandom();
    private final byte[] key;

    public OrchCipher(@Value("${oa.orch.cred-secret:${oa.jwt.secret:}}") String secret) {
        String material = StringUtils.hasText(secret) ? secret : "oa-orch-dev-secret";
        if (!StringUtils.hasText(secret)) {
            log.warn("编排凭据加密密钥未配置（OA_CRED_SECRET/OA_JWT_SECRET），使用开发缺省密钥——生产必须配置");
        }
        try {
            this.key = MessageDigest.getInstance("SHA-256").digest(material.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("凭据加密初始化失败", e);
        }
    }

    public String encrypt(String plain) {
        if (plain == null) {
            return null;
        }
        try {
            byte[] iv = new byte[12];
            RANDOM.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            byte[] ct = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return Base64.getEncoder().encodeToString(out);
        } catch (Exception e) {
            throw new IllegalStateException("凭据加密失败", e);
        }
    }

    public String decrypt(String enc) {
        if (enc == null) {
            return null;
        }
        try {
            byte[] all = Base64.getDecoder().decode(enc);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(128, all, 0, 12));
            return new String(cipher.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("凭据解密失败", e);
        }
    }
}
