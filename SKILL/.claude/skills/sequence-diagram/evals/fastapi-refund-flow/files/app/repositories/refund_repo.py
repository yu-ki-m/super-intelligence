from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Refund


async def create(session: AsyncSession, *, order_id: int, amount: Decimal, reason: str) -> Refund:
    refund = Refund(order_id=order_id, amount=amount, reason=reason, status="REQUESTED")
    session.add(refund)
    await session.flush()  # INSERT を発行して refund.id を採番する
    return refund
