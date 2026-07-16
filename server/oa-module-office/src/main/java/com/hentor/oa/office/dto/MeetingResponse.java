package com.hentor.oa.office.dto;

import java.time.LocalDate;

public record MeetingResponse(
        Long id,
        String subject,
        String roomName,
        String organizer,
        Long organizerId,
        LocalDate date,
        Integer startHour,
        Integer endHour,
        /** UPCOMING / ONGOING / FINISHED / CANCELED */
        String status,
        /** HOST / ATTENDEE */
        String role
) {
}
