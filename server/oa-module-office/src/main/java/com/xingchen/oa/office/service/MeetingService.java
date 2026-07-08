package com.xingchen.oa.office.service;

import com.xingchen.oa.common.core.PageResult;
import com.xingchen.oa.common.exception.BusinessException;
import com.xingchen.oa.common.security.UserContext;
import com.xingchen.oa.office.dto.MeetingCreateRequest;
import com.xingchen.oa.office.dto.MeetingResponse;
import com.xingchen.oa.office.dto.MeetingRoomResponse;
import com.xingchen.oa.office.entity.Meeting;
import com.xingchen.oa.office.entity.MeetingRoom;
import com.xingchen.oa.office.repository.MeetingRepository;
import com.xingchen.oa.office.repository.MeetingRoomRepository;
import com.xingchen.oa.office.support.SecuritySupport;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class MeetingService {

    public static final String STATUS_UPCOMING = "UPCOMING";
    public static final String STATUS_ONGOING = "ONGOING";
    public static final String STATUS_FINISHED = "FINISHED";

    private final MeetingRoomRepository roomRepository;
    private final MeetingRepository meetingRepository;

    /**
     * 会议室列表 + 指定日期（默认今天）的预订时段。
     */
    public List<MeetingRoomResponse> rooms(LocalDate date) {
        LocalDate target = date != null ? date : LocalDate.now();
        Map<Long, List<Meeting>> byRoom = meetingRepository
                .findByMeetingDateAndStatusNot(target, Meeting.STATUS_CANCELED).stream()
                .collect(Collectors.groupingBy(Meeting::getRoomId));
        return roomRepository.findAll(Sort.by("id")).stream()
                .map(room -> {
                    List<Meeting> meetings = byRoom.getOrDefault(room.getId(), List.of()).stream()
                            .sorted(Comparator.comparing(Meeting::getStartHour))
                            .toList();
                    List<MeetingRoomResponse.Booking> bookings = meetings.stream()
                            .map(m -> new MeetingRoomResponse.Booking(
                                    m.getStartHour(), m.getEndHour(), m.getSubject(), m.getOrganizer()))
                            .toList();
                    return new MeetingRoomResponse(
                            room.getId(), room.getName(), room.getFloor(), room.getCapacity(),
                            splitToList(room.getDevices()),
                            roomStatus(room, target, meetings),
                            bookings);
                })
                .toList();
    }

    /**
     * 预订会议：同会议室同日期时段重叠 → 409。
     */
    @Transactional
    public MeetingResponse create(MeetingCreateRequest request) {
        UserContext context = SecuritySupport.currentUser();
        MeetingRoom room = roomRepository.findById(request.roomId())
                .orElseThrow(() -> new BusinessException(404, "会议室不存在"));
        if (MeetingRoom.STATUS_MAINTAIN.equals(room.getStatus())) {
            throw new BusinessException(400, "会议室维护中，暂不可预订");
        }
        if (request.startHour() < 0 || request.endHour() > 24 || request.startHour() >= request.endHour()) {
            throw new BusinessException(400, "会议时段不合法");
        }
        boolean conflict = meetingRepository
                .findByRoomIdAndMeetingDateAndStatusNot(request.roomId(), request.date(), Meeting.STATUS_CANCELED)
                .stream()
                .anyMatch(m -> request.startHour() < m.getEndHour() && request.endHour() > m.getStartHour());
        if (conflict) {
            throw new BusinessException(409, "该时段已被预订");
        }
        Meeting meeting = new Meeting();
        meeting.setRoomId(request.roomId());
        meeting.setSubject(request.subject());
        meeting.setMeetingDate(request.date());
        meeting.setStartHour(request.startHour());
        meeting.setEndHour(request.endHour());
        meeting.setOrganizer(SecuritySupport.displayName(context));
        meeting.setOrganizerId(context.getUserId());
        meeting.setAttendeeIds("");
        meeting.setStatus(Meeting.STATUS_BOOKED);
        Meeting saved = meetingRepository.save(meeting);
        return toResponse(saved, room.getName(), context.getUserId());
    }

    /**
     * 我的会议：我组织的（HOST）或我参加的（ATTENDEE）。
     */
    public PageResult<MeetingResponse> my(int pageNum, int pageSize) {
        Long userId = SecuritySupport.currentUser().getUserId();
        List<Meeting> mine = meetingRepository
                .findByOrganizerIdOrAttendeeIdsContaining(userId, String.valueOf(userId)).stream()
                .filter(m -> involved(m, userId))
                .sorted(Comparator.comparing(Meeting::getMeetingDate).reversed()
                        .thenComparing(Meeting::getStartHour))
                .toList();
        int from = Math.min(Math.max(pageNum - 1, 0) * pageSize, mine.size());
        int to = Math.min(from + pageSize, mine.size());
        Map<Long, String> roomNames = roomRepository.findAll().stream()
                .collect(Collectors.toMap(MeetingRoom::getId, MeetingRoom::getName, (a, b) -> a));
        List<MeetingResponse> list = mine.subList(from, to).stream()
                .map(m -> toResponse(m, roomNames.get(m.getRoomId()), userId))
                .toList();
        return new PageResult<>(list, mine.size(), pageNum, pageSize);
    }

    /**
     * 取消会议：仅组织者且未开始。
     */
    @Transactional
    public MeetingResponse cancel(Long id) {
        Long userId = SecuritySupport.currentUser().getUserId();
        Meeting meeting = meetingRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "会议不存在"));
        if (!Objects.equals(meeting.getOrganizerId(), userId)) {
            throw new BusinessException(403, "仅会议组织者可取消");
        }
        String status = computeStatus(meeting, LocalDateTime.now());
        if (Meeting.STATUS_CANCELED.equals(status)) {
            throw new BusinessException(400, "会议已取消");
        }
        if (!STATUS_UPCOMING.equals(status)) {
            throw new BusinessException(400, "会议已开始或已结束，无法取消");
        }
        meeting.setStatus(Meeting.STATUS_CANCELED);
        Meeting saved = meetingRepository.save(meeting);
        String roomName = roomRepository.findById(saved.getRoomId())
                .map(MeetingRoom::getName).orElse(null);
        return toResponse(saved, roomName, userId);
    }

    /**
     * 今日与我相关且未取消的会议数（工作台）。
     */
    public long countTodayInvolved(Long userId) {
        return meetingRepository.findByMeetingDateAndStatusNot(LocalDate.now(), Meeting.STATUS_CANCELED).stream()
                .filter(m -> involved(m, userId))
                .count();
    }

    private boolean involved(Meeting meeting, Long userId) {
        if (Objects.equals(meeting.getOrganizerId(), userId)) {
            return true;
        }
        return splitToList(meeting.getAttendeeIds()).contains(String.valueOf(userId));
    }

    private String roomStatus(MeetingRoom room, LocalDate date, List<Meeting> dayMeetings) {
        if (MeetingRoom.STATUS_MAINTAIN.equals(room.getStatus())) {
            return MeetingRoom.STATUS_MAINTAIN;
        }
        if (LocalDate.now().equals(date)) {
            int nowHour = LocalTime.now().getHour();
            boolean busy = dayMeetings.stream()
                    .anyMatch(m -> m.getStartHour() <= nowHour && nowHour < m.getEndHour());
            if (busy) {
                return MeetingRoom.STATUS_BUSY;
            }
        }
        return MeetingRoom.STATUS_FREE;
    }

    private String computeStatus(Meeting meeting, LocalDateTime now) {
        if (Meeting.STATUS_CANCELED.equals(meeting.getStatus())) {
            return Meeting.STATUS_CANCELED;
        }
        LocalDate today = now.toLocalDate();
        if (meeting.getMeetingDate().isAfter(today)) {
            return STATUS_UPCOMING;
        }
        if (meeting.getMeetingDate().isBefore(today)) {
            return STATUS_FINISHED;
        }
        LocalTime time = now.toLocalTime();
        LocalTime start = hourOf(meeting.getStartHour());
        LocalTime end = hourOf(meeting.getEndHour());
        if (time.isBefore(start)) {
            return STATUS_UPCOMING;
        }
        if (!time.isBefore(end)) {
            return STATUS_FINISHED;
        }
        return STATUS_ONGOING;
    }

    private LocalTime hourOf(int hour) {
        return hour >= 24 ? LocalTime.MAX : LocalTime.of(Math.max(hour, 0), 0);
    }

    private MeetingResponse toResponse(Meeting meeting, String roomName, Long currentUserId) {
        return new MeetingResponse(
                meeting.getId(),
                meeting.getSubject(),
                roomName,
                meeting.getOrganizer(),
                meeting.getOrganizerId(),
                meeting.getMeetingDate(),
                meeting.getStartHour(),
                meeting.getEndHour(),
                computeStatus(meeting, LocalDateTime.now()),
                Objects.equals(meeting.getOrganizerId(), currentUserId) ? "HOST" : "ATTENDEE");
    }

    private List<String> splitToList(String joined) {
        if (!StringUtils.hasText(joined)) {
            return List.of();
        }
        return Arrays.stream(joined.split(","))
                .map(String::trim)
                .filter(StringUtils::hasText)
                .toList();
    }
}
