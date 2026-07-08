package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.Meeting;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;

public interface MeetingRepository extends JpaRepository<Meeting, Long> {

    List<Meeting> findByMeetingDateAndStatusNot(LocalDate meetingDate, String status);

    List<Meeting> findByRoomIdAndMeetingDateAndStatusNot(Long roomId, LocalDate meetingDate, String status);

    /**
     * 候选“与我相关”的会议（attendeeIds 为模糊包含，需在内存中精确二次过滤）。
     */
    List<Meeting> findByOrganizerIdOrAttendeeIdsContaining(Long organizerId, String attendeeId);
}
