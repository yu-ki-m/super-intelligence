package com.example.order.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

/** 注文明細（order_lines）。 */
@Entity
@Table(name = "order_lines")
public class OrderLine {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne
    private Order order;
    private String productId;
    private int quantity;

    protected OrderLine() {
    }

    OrderLine(Order order, String productId, int quantity) {
        this.order = order;
        this.productId = productId;
        this.quantity = quantity;
    }
}
