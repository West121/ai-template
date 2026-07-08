package com.xingchen.oa.workflow.notify;

import com.xingchen.oa.workflow.entity.WfNotify;
import com.xingchen.oa.workflow.repository.WfNotifyRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** 内置站内通知渠道：写 wf_notify 收件箱（header 铃铛读取）。 */
@Component
@RequiredArgsConstructor
public class StationNotifyChannel implements NotifyChannel {

    private final WfNotifyRepository notifyRepository;

    @Override
    public String type() {
        return "STATION";
    }

    @Override
    public void send(NotifyMessage m) {
        if (m.userId() == null) {
            return;
        }
        WfNotify n = new WfNotify();
        n.setUserId(m.userId());
        n.setType(m.type());
        n.setTitle(m.title());
        n.setContent(m.content());
        n.setProcInstId(m.procInstId());
        n.setReadFlag(false);
        notifyRepository.save(n);
    }
}
