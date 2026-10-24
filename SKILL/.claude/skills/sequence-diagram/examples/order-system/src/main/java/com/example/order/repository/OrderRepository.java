package com.example.order.repository;

import com.example.order.domain.Order;
import org.springframework.data.jpa.repository.JpaRepository;

/** orders / order_lines テーブル（Spring Data JPA。明細は Order からカスケード保存）。 */
public interface OrderRepository extends JpaRepository<Order, Long> {
}
