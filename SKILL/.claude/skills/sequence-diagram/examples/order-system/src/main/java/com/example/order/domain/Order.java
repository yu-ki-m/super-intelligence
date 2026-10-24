package com.example.order.domain;

import com.example.order.service.OrderLineCommand;
import com.example.order.service.PriceQuote;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/** 注文（orders）。明細（order_lines）は注文と一緒にカスケード保存される。 */
@Entity
@Table(name = "orders")
public class Order {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private Long customerId;
    private BigDecimal totalAmount;
    @Enumerated(EnumType.STRING)
    private OrderStatus status;
    private String paymentTransactionId;
    private String paymentFailureReason;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL)
    private List<OrderLine> lines = new ArrayList<>();

    protected Order() {
    }

    public static Order create(Long customerId, List<OrderLineCommand> lineCommands, PriceQuote quote) {
        Order order = new Order();
        order.customerId = customerId;
        order.status = OrderStatus.PENDING_PAYMENT;
        for (OrderLineCommand c : lineCommands) {
            order.lines.add(new OrderLine(order, c.productId(), c.quantity()));
        }
        order.totalAmount = quote.totalAmount();
        return order;
    }

    public void markPaid(String transactionId) {
        this.paymentTransactionId = transactionId;
        this.status = OrderStatus.CONFIRMED;
    }

    public void markPaymentFailed(String reasonCode) {
        this.paymentFailureReason = reasonCode;
        this.status = OrderStatus.PAYMENT_FAILED;
    }

    public Long getId() { return id; }
    public Long getCustomerId() { return customerId; }
    public BigDecimal getTotalAmount() { return totalAmount; }
    public OrderStatus getStatus() { return status; }
    public List<OrderLine> getLines() { return lines; }
}
