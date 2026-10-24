package com.example.order.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;

/** 商品（products）。 */
@Entity
@Table(name = "products")
public class Product {

    @Id
    private String id;
    private String name;
    private BigDecimal unitPrice;

    public String getId() { return id; }
    public BigDecimal getUnitPrice() { return unitPrice; }
}
