package com.hentor.oa.common.core;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 统一响应结构：{code, message, data}，code = 0 表示成功。
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class R<T> {

    public static final int SUCCESS = 0;

    private int code;
    private String message;
    private T data;

    public static <T> R<T> ok(T data) {
        return new R<>(SUCCESS, "ok", data);
    }

    public static <T> R<T> ok() {
        return ok(null);
    }

    public static <T> R<T> fail(int code, String message) {
        return new R<>(code, message, null);
    }
}
