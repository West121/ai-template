package com.xingchen.oa.common.exception;

import com.xingchen.oa.common.core.R;
import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * 全局异常处理。
 *
 * <p>约定：HTTP 恒为 200，语义由响应体 envelope 的 {@code code} 承载（与既有 BusinessException 处理一致）。
 * 框架级异常（方法不支持 / 请求体解析失败 / 参数缺失或类型不符）以往会落到兜底的
 * {@code Exception} 分支被误报为 500「服务器内部错误」，现按真实语义映射为 405 / 400，
 * 避免出现诸如「GET 一个只映射了 POST 的路径」返回 500 的误导（如 GET /api/system/depts）。
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public R<Void> handleBusinessException(BusinessException e) {
        return R.fail(e.getCode(), e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public R<Void> handleValidException(MethodArgumentNotValidException e) {
        FieldError fieldError = e.getBindingResult().getFieldError();
        String message = fieldError != null ? fieldError.getDefaultMessage() : "参数校验失败";
        return R.fail(400, message);
    }

    /** @RequestParam 等约束校验失败。 */
    @ExceptionHandler(ConstraintViolationException.class)
    public R<Void> handleConstraintViolation(ConstraintViolationException e) {
        return R.fail(400, "参数校验失败");
    }

    /** 请求体缺失 / JSON 解析失败。 */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public R<Void> handleNotReadable(HttpMessageNotReadableException e) {
        return R.fail(400, "请求体解析失败");
    }

    /** 缺少必需的查询参数。 */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public R<Void> handleMissingParam(MissingServletRequestParameterException e) {
        return R.fail(400, "缺少必需参数: " + e.getParameterName());
    }

    /** 参数类型不匹配（如 /{id} 传了非数字）。 */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public R<Void> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return R.fail(400, "参数类型不匹配: " + e.getName());
    }

    /** 请求方法不被该路径支持（如对只映射了 POST 的集合路径发起 GET）。 */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public R<Void> handleMethodNotSupported(HttpRequestMethodNotSupportedException e) {
        return R.fail(405, "请求方法不支持: " + e.getMethod());
    }

    @ExceptionHandler(Exception.class)
    public R<Void> handleException(Exception e) {
        log.error("未处理异常", e);
        return R.fail(500, "服务器内部错误");
    }
}
