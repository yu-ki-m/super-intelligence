package com.example.order.exception;

/** 決済代行サービスが承認を拒否した（HTTP 402）。 */
public class PaymentDeclinedException extends BusinessException {

    private final String reasonCode;

    public PaymentDeclinedException(Long orderId, String reasonCode) {
        super("PAYMENT_DECLINED", "決済が承認されませんでした: order=" + orderId);
        this.reasonCode = reasonCode;
    }

    public String getReasonCode() { return reasonCode; }
}
