package com.example.order.service;

import com.example.order.domain.Product;
import com.example.order.exception.ProductNotFoundException;
import com.example.order.repository.ProductRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/** 明細の価格と税込合計を計算する。 */
@Service
public class PricingService {

    private static final BigDecimal TAX_RATE = new BigDecimal("0.10");

    private final ProductRepository productRepository;

    public PricingService(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    public PriceQuote quote(List<OrderLineCommand> lines) {
        List<String> ids = lines.stream().map(OrderLineCommand::productId).toList();
        Map<String, Product> products = productRepository.findAllById(ids).stream()
                .collect(Collectors.toMap(Product::getId, Function.identity()));

        BigDecimal subtotal = BigDecimal.ZERO;
        for (OrderLineCommand line : lines) {
            Product product = products.get(line.productId());
            if (product == null) {
                throw new ProductNotFoundException(line.productId());
            }
            subtotal = subtotal.add(product.getUnitPrice().multiply(BigDecimal.valueOf(line.quantity())));
        }
        BigDecimal tax = subtotal.multiply(TAX_RATE).setScale(0, RoundingMode.DOWN);
        return new PriceQuote(subtotal, tax, subtotal.add(tax));
    }
}
