package com.example.order.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** 顧客（customers）。 */
@Entity
@Table(name = "customers")
public class Customer {

    @Id
    private Long id;
    private String name;
    private String status;

    public boolean isSuspended() {
        return "SUSPENDED".equals(status);
    }

    public Long getId() { return id; }
}
