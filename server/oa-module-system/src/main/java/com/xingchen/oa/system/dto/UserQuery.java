package com.xingchen.oa.system.dto;

import lombok.Data;

@Data
public class UserQuery {

    private String keyword;
    private int pageNum = 1;
    private int pageSize = 10;
}
