package com.hentor.oa.common.exception;

import lombok.Getter;

/**
 * 业务异常，携带业务错误码，默认 400。
 */
@Getter
public class BusinessException extends RuntimeException {

    private final int code;

    public BusinessException(String message) {
        this(400, message);
    }

    public BusinessException(int code, String message) {
        super(message);
        this.code = code;
    }
}
