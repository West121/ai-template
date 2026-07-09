package com.xingchen.oa.office.repository;

import com.xingchen.oa.office.entity.Meeting;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface MeetingRepository extends JpaRepository<Meeting, Long> {

    List<Meeting> findByMeetingDateAndStatusNot(LocalDate meetingDate, String status);

    List<Meeting> findByRoomIdAndMeetingDateAndStatusNot(Long roomId, LocalDate meetingDate, String status);

    /**
     * 候选“与我相关”的会议（attendeeIds 为模糊包含，需在内存中精确二次过滤）。
     */
    List<Meeting> findByOrganizerIdOrAttendeeIdsContaining(Long organizerId, String attendeeId);

    /**
     * 我组织的（organizerId=我）或我参加的（attendee_ids 精确含我）会议，DB 层分页（B-08）。
     * attendee_ids 为逗号连接的 id 串（如 "1,3"），用两侧补逗号 + 边界 LIKE 精确匹配成员，
     * 避免 "1" 误命中 "11"，等价于原内存 {@code involved()} 精确过滤，total 亦由 DB 计算准确。
     */
    @Query("""
            select m from Meeting m
            where m.organizerId = :userId
               or concat(',', m.attendeeIds, ',') like concat('%,', :userIdText, ',%')
            """)
    Page<Meeting> findMine(@Param("userId") Long userId,
                           @Param("userIdText") String userIdText,
                           Pageable pageable);
}
