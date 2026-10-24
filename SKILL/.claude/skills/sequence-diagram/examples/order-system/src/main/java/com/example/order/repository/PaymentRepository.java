package com.example.order.repository;

import com.example.order.domain.Payment;
import org.springframework.data.jpa.repository.JpaRepository;

/** payments テーブル（Spring Data JPA）。 */
public interface PaymentRepository extends JpaRepository<Payment, Long> {
}
