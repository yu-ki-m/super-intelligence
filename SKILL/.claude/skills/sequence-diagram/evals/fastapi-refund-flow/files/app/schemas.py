from decimal import Decimal

from pydantic import BaseModel, Field


class RefundItem(BaseModel):
    product_id: str
    quantity: int = Field(gt=0)


class RefundRequest(BaseModel):
    items: list[RefundItem] = Field(min_length=1)
    reason: str = Field(max_length=200)


class RefundResponse(BaseModel):
    refund_id: int
    amount: Decimal
    status: str
