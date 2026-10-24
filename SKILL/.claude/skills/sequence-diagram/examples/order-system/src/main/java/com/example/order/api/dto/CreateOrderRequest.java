package com.example.order.api.dto;

import com.example.order.service.CreateOrderCommand;
import com.example.order.service.OrderLineCommand;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/** POST /api/orders のリクエストボディ。 */
public record CreateOrderRequest(
        @NotNull Long customerId,
        @NotEmpty @Valid List<Line> lines) {

    public record Line(@NotBlank String productId, @Min(1) int quantity) {
    }

    public CreateOrderCommand toCommand() {
        return new CreateOrderCommand(customerId,
                lines.stream().map(l -> new OrderLineCommand(l.productId(), l.quantity())).toList());
    }
}
