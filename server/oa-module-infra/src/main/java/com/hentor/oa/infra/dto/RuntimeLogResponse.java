package com.hentor.oa.infra.dto;

import java.util.List;

/**
 * 契约：GET /api/infra/logs/runtime?lines=200 → {file,lines:string[]}
 */
public record RuntimeLogResponse(String file, List<String> lines) {
}
