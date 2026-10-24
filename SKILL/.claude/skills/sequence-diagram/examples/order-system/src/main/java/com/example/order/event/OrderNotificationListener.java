package com.example.order.event;

import com.example.order.domain.Order;
import com.example.order.infra.MailSender;
import com.example.order.repository.OrderRepository;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** 注文確定後の通知。注文登録トランザクションのコミット後に、別スレッドで実行される。 */
@Component
public class OrderNotificationListener {

    private final OrderRepository orderRepository;
    private final MailSender mailSender;
    private final KafkaTemplate<String, OrderEventMessage> kafkaTemplate;

    public OrderNotificationListener(OrderRepository orderRepository, MailSender mailSender,
            KafkaTemplate<String, OrderEventMessage> kafkaTemplate) {
        this.orderRepository = orderRepository;
        this.mailSender = mailSender;
        this.kafkaTemplate = kafkaTemplate;
    }

    @Async("notificationExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderPlaced(OrderPlacedEvent event) {
        Order order = orderRepository.findById(event.orderId()).orElseThrow();
        mailSender.sendOrderConfirmation(order);
        kafkaTemplate.send("order-events", String.valueOf(order.getId()), OrderEventMessage.from(order));
    }
}
