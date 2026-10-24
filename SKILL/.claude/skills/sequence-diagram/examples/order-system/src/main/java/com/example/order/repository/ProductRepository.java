package com.example.order.repository;

import com.example.order.domain.Product;
import org.springframework.data.jpa.repository.JpaRepository;

/** products テーブル（Spring Data JPA）。 */
public interface ProductRepository extends JpaRepository<Product, String> {
}
