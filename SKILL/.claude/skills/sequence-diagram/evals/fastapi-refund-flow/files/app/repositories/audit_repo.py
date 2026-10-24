from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


async def log(session: AsyncSession, action: str, order_id: int) -> None:
    session.add(AuditLog(action=action, order_id=order_id))
    await session.flush()
