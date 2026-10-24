package com.example.order.repository;

import com.example.order.domain.Customer;
import org.springframework.data.jpa.repository.JpaRepository;

/** customers テーブル（Spring Data JPA）。 */
public interface CustomerRepository extends JpaRepository<Customer, Long> {
}
