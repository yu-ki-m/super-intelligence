package com.example.order.domain;

import com.example.order.infra.PaymentResult;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;

/** 決済記録（payments）。 */
@Entity
@Table(name = "payments")
public class Payment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private Long orderId;
    private String transactionId;
    private BigDecimal amount;
    private String status;

    protected Payment() {
    }

    public static Payment authorized(Long orderId, PaymentResult result) {
        Payment p = new Payment();
        p.orderId = orderId;
        p.transactionId = result.transactionId();
        p.amount = result.amount();
        p.status = "AUTHORIZED";
        return p;
    }
}
