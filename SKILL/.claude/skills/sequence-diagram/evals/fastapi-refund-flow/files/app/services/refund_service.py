import asyncio
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.clients import inventory_client, payment_client, points_client
from app.clients.payment_client import PaymentGatewayError
from app.errors import OrderNotFound, RefundFailed, RefundNotAllowed
from app.models import Order, OrderStatus, User
from app.repositories import audit_repo, order_repo, refund_repo
from app.schemas import RefundItem, RefundRequest

REFUNDABLE = (OrderStatus.SHIPPED, OrderStatus.DELIVERED)


@dataclass
class RefundResult:
    refund_id: int
    amount: Decimal


def calc_refund_amount(order: Order, items: list[RefundItem]) -> Decimal:
    """返金額 = 対象明細の単価 × 返品数量 の合計（注文合計を上限とする）。"""
    unit_prices = {line.product_id: line.unit_price for line in order.lines}
    total = Decimal("0")
    for item in items:
        total += unit_prices[item.product_id] * item.quantity
    return min(total, order.total_amount)


async def request_refund(session: AsyncSession, order_id: int, req: RefundRequest, user: User) -> RefundResult:
    async with session.begin():
        order = await order_repo.get_for_update(session, order_id)
        if order is None or order.user_id != user.id:
            raise OrderNotFound(order_id)
        if order.status not in REFUNDABLE:
            raise RefundNotAllowed(order_id, order.status)

        amount = calc_refund_amount(order, req.items)
        refund = await refund_repo.create(session, order_id=order.id, amount=amount, reason=req.reason)

        try:
            result = await payment_client.refund(order.payment_id, amount)
        except PaymentGatewayError as e:
            refund.status = "FAILED"
            refund.failure_code = e.code
            raise RefundFailed(order_id) from e
        finally:
            await audit_repo.log(session, "REFUND_REQUEST", order.id)

        refund.status = "COMPLETED"
        refund.gateway_ref = result.reference
        order.status = OrderStatus.REFUNDED

        # 在庫の戻しとポイントの取り消しは別サービスなので同時に実行する
        await asyncio.gather(
            inventory_client.restock(req.items),
            points_client.revoke(user.id, order.earned_points),
        )

    return RefundResult(refund_id=refund.id, amount=amount)
