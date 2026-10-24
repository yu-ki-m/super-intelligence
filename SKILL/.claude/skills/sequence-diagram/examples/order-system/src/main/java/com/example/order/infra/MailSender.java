package com.example.order.infra;

import com.example.order.domain.Order;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

/** 注文確認メールの送信（SMTP）。 */
@Component
public class MailSender {

    private final JavaMailSender javaMailSender;

    public MailSender(JavaMailSender javaMailSender) {
        this.javaMailSender = javaMailSender;
    }

    public void sendOrderConfirmation(Order order) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setSubject("ご注文ありがとうございます（注文番号 " + order.getId() + "）");
        message.setText("お支払い金額: " + order.getTotalAmount());
        javaMailSender.send(message);
    }
}
