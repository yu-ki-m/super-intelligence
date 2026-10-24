package com.example.order.service;

import com.example.order.domain.Order;
import com.example.order.domain.Payment;
import com.example.order.exception.PaymentDeclinedException;
import com.example.order.infra.AuditLogger;
import com.example.order.infra.PaymentGatewayClient;
import com.example.order.infra.PaymentRequest;
import com.example.order.infra.PaymentResult;
import com.example.order.repository.PaymentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** 決済代行サービスへの承認依頼と結果の記録。 */
@Service
public class PaymentService {

    private static final Logger log = LoggerFactory.getLogger(PaymentService.class);

    private final PaymentGatewayClient paymentGatewayClient;
    private final PaymentRepository paymentRepository;
    private final AuditLogger auditLogger;

    public PaymentService(PaymentGatewayClient paymentGatewayClient, PaymentRepository paymentRepository,
            AuditLogger auditLogger) {
        this.paymentGatewayClient = paymentGatewayClient;
        this.paymentRepository = paymentRepository;
        this.auditLogger = auditLogger;
    }

    public void authorize(Order order) {
        PaymentRequest request = PaymentRequest.of(order.getId(), order.getTotalAmount(), order.getCustomerId());
        try {
            PaymentResult result = paymentGatewayClient.authorize(request);
            order.markPaid(result.transactionId());
            paymentRepository.save(Payment.authorized(order.getId(), result));
        } catch (PaymentDeclinedException e) {
            log.warn("payment declined: order={}, reason={}", order.getId(), e.getReasonCode());
            order.markPaymentFailed(e.getReasonCode());
            throw e;
        } finally {
            auditLogger.record("PAYMENT_AUTHORIZE", order.getId());
        }
    }
}
