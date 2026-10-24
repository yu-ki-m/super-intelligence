package com.example.order.repository;

import com.example.order.domain.Stock;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** stocks / stock_movements テーブル（MyBatis。SQL は resources/mapper/StockMapper.xml）。 */
@Mapper
public interface StockMapper {

    Stock selectForUpdate(@Param("productId") String productId);

    int decreaseAvailable(@Param("productId") String productId, @Param("quantity") int quantity,
            @Param("version") long version);

    int insertMovement(@Param("productId") String productId, @Param("delta") int delta,
            @Param("reason") String reason);
}
