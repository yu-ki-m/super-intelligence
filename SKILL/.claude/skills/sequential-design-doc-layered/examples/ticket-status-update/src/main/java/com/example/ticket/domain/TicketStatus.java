package com.example.ticket.domain;

import com.example.ticket.exception.InvalidStatusException;
import java.util.Locale;

public enum TicketStatus {
    OPEN, IN_PROGRESS, RESOLVED, CLOSED, REJECTED;

    /** リクエストの文字列をステータスに変換する（前後の空白を除き、大文字にして照合）。 */
    public static TicketStatus parse(String value) {
        try {
            return TicketStatus.valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new InvalidStatusException(value);
        }
    }
}
