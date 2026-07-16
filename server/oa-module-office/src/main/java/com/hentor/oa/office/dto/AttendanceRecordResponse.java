package com.hentor.oa.office.dto;

import java.time.LocalDate;

public record AttendanceRecordResponse(
        LocalDate date,
        String week,
        /** HH:mm */
        String checkIn,
        String checkOut,
        Double hours,
        String status
) {
}
