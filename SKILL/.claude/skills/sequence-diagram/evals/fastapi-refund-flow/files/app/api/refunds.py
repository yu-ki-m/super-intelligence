from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_session
from app.models import User
from app.schemas import RefundRequest, RefundResponse
from app.services import refund_service

router = APIRouter(prefix="/orders", tags=["refunds"])


@router.post("/{order_id}/refunds", status_code=status.HTTP_201_CREATED, response_model=RefundResponse)
async def create_refund(
    order_id: int,
    payload: RefundRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> RefundResponse:
    """返金を申請する。payload は Pydantic で検証済み（違反時は 422）。"""
    result = await refund_service.request_refund(session, order_id, payload, user)
    return RefundResponse(refund_id=result.refund_id, amount=result.amount, status="COMPLETED")
