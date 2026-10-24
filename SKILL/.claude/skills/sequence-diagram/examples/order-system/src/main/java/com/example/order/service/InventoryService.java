package com.example.order.service;

import com.example.order.domain.Stock;
import com.example.order.exception.ConcurrentUpdateException;
import com.example.order.exception.OutOfStockException;
import com.example.order.exception.ProductNotFoundException;
import com.example.order.repository.StockMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** 在庫の引当。呼び出し元のトランザクション内でのみ実行できる。 */
@Service
public class InventoryService {

    private final StockMapper stockMapper;

    public InventoryService(StockMapper stockMapper) {
        this.stockMapper = stockMapper;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void allocate(String productId, int quantity) {
        // 在庫行を排他ロックして取得する（ロックはトランザクション終了まで保持）
        Stock stock = stockMapper.selectForUpdate(productId);
        if (stock == null) {
            throw new ProductNotFoundException(productId);
        }
        if (stock.getAvailable() < quantity) {
            throw new OutOfStockException(productId, quantity, stock.getAvailable());
        }
        int updated = stockMapper.decreaseAvailable(productId, quantity, stock.getVersion());
        if (updated != 1) {
            throw new ConcurrentUpdateException("stocks", productId);
        }
        stockMapper.insertMovement(productId, -quantity, "ALLOCATE");
    }
}
