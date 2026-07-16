package com.hentor.oa.office.dto;

import java.util.List;

/**
 * 会议室 + 指定日期的预订时段。
 */
public record MeetingRoomResponse(
        Long id,
        String name,
        String floor,
        Integer capacity,
        List<String> devices,
        String status,
        List<Booking> bookings
) {

    public record Booking(
            Integer startHour,
            Integer endHour,
            String subject,
            String booker
    ) {
    }
}
