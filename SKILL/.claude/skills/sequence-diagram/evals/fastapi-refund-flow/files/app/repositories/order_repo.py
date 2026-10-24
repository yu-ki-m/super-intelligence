from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Order


async def get_for_update(session: AsyncSession, order_id: int) -> Order | None:
    """注文を行ロック（SELECT ... FOR UPDATE）して取得する。明細も読み込む。"""
    stmt = (
        select(Order)
        .where(Order.id == order_id)
        .options(selectinload(Order.lines))
        .with_for_update()
    )
    return (await session.execute(stmt)).scalar_one_or_none()
