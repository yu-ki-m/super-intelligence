package com.example.order.service;

import com.example.order.domain.Customer;
import com.example.order.domain.Order;
import com.example.order.event.OrderPlacedEvent;
import com.example.order.exception.CreditLimitExceededException;
import com.example.order.exception.CustomerNotFoundException;
import com.example.order.exception.CustomerSuspendedException;
import com.example.order.infra.CreditCheckClient;
import com.example.order.infra.CreditStatus;
import com.example.order.repository.CustomerRepository;
import com.example.order.repository.OrderRepository;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderServiceImpl implements OrderService {

    private final CustomerRepository customerRepository;
    private final OrderRepository orderRepository;
    private final CreditCheckClient creditCheckClient;
    private final PricingService pricingService;
    private final InventoryService inventoryService;
    private final PaymentService paymentService;
    private final ApplicationEventPublisher eventPublisher;
    private final Executor orderExecutor;

    public OrderServiceImpl(CustomerRepository customerRepository, OrderRepository orderRepository,
            CreditCheckClient creditCheckClient, PricingService pricingService,
            InventoryService inventoryService, PaymentService paymentService,
            ApplicationEventPublisher eventPublisher,
            @Qualifier("orderExecutor") Executor orderExecutor) {
        this.customerRepository = customerRepository;
        this.orderRepository = orderRepository;
        this.creditCheckClient = creditCheckClient;
        this.pricingService = pricingService;
        this.inventoryService = inventoryService;
        this.paymentService = paymentService;
        this.eventPublisher = eventPublisher;
        this.orderExecutor = orderExecutor;
    }

    @Override
    @Transactional
    public OrderResult registerOrder(CreateOrderCommand command) {
        // 1. 顧客の取得と利用状態の確認
        Customer customer = customerRepository.findById(command.customerId())
                .orElseThrow(() -> new CustomerNotFoundException(command.customerId()));
        if (customer.isSuspended()) {
            throw new CustomerSuspendedException(customer.getId());
        }

        // 2. 与信照会と見積計算を並列に実行し、両方の完了を待つ
        CompletableFuture<CreditStatus> creditFuture = CompletableFuture
                .supplyAsync(() -> creditCheckClient.check(customer.getId()), orderExecutor);
        CompletableFuture<PriceQuote> quoteFuture = CompletableFuture
                .supplyAsync(() -> pricingService.quote(command.lines()), orderExecutor);
        CompletableFuture.allOf(creditFuture, quoteFuture).join();
        CreditStatus credit = creditFuture.join();
        PriceQuote quote = quoteFuture.join();

        if (quote.totalAmount().compareTo(credit.availableLimit()) > 0) {
            throw new CreditLimitExceededException(customer.getId(), quote.totalAmount());
        }

        // 3. 明細ごとに在庫を引き当てる
        for (OrderLineCommand line : command.lines()) {
            inventoryService.allocate(line.productId(), line.quantity());
        }

        // 4. 注文を生成して保存する
        Order order = Order.create(customer.getId(), command.lines(), quote);
        orderRepository.save(order);

        // 5. 決済の承認
        paymentService.authorize(order);

        // 6. 注文確定イベントを発行（通知はコミット後に非同期で行われる）
        eventPublisher.publishEvent(new OrderPlacedEvent(order.getId()));
        return OrderResult.from(order);
    }
}
