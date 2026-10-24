package com.example.order.exception;

public class ConcurrentUpdateException extends BusinessException {

    public ConcurrentUpdateException(String table, String key) {
        super("CONCURRENT_UPDATE", "他の処理と競合しました: " + table + "/" + key);
    }
}
