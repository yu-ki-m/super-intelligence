package com.example.order.api;

import com.example.order.api.dto.CreateOrderRequest;
import com.example.order.api.dto.OrderResponse;
import com.example.order.service.CreateOrderCommand;
import com.example.order.service.OrderResult;
import com.example.order.service.OrderService;
import jakarta.validation.Valid;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 注文 API。 */
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    /**
     * 注文を登録する。
     * リクエストは @Valid により Bean Validation 済みの状態で渡される。
     */
    @PostMapping
    public ResponseEntity<OrderResponse> createOrder(@Valid @RequestBody CreateOrderRequest request) {
        CreateOrderCommand command = request.toCommand();
        OrderResult result = orderService.registerOrder(command);
        return ResponseEntity
                .created(URI.create("/api/orders/" + result.orderId()))
                .body(OrderResponse.from(result));
    }
}
