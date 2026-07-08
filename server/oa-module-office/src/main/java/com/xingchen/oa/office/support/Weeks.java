package com.xingchen.oa.office.support;

import java.time.LocalDate;

/**
 * 星期中文标签：周一 ~ 周日。
 */
public final class Weeks {

    private static final String[] LABELS = {"周一", "周二", "周三", "周四", "周五", "周六", "周日"};

    private Weeks() {
    }

    public static String label(LocalDate date) {
        return LABELS[date.getDayOfWeek().getValue() - 1];
    }
}
