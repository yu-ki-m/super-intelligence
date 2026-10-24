package com.example.order.domain;

/** 在庫（stocks）。MyBatis で読み書きする。 */
public class Stock {

    private String productId;
    private int available;
    private long version;

    public String getProductId() { return productId; }
    public int getAvailable() { return available; }
    public long getVersion() { return version; }
}
