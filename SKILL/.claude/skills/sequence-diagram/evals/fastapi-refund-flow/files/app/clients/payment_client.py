from dataclasses import dataclass
from decimal import Decimal

import httpx

from app.config import settings


class PaymentGatewayError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass
class GatewayRefund:
    reference: str


async def refund(payment_id: str, amount: Decimal) -> GatewayRefund:
    """決済代行サービスへ返金を依頼する。2xx 以外は PaymentGatewayError。"""
    async with httpx.AsyncClient(base_url=settings.payment_base_url, timeout=10.0) as client:
        res = await client.post(f"/payments/{payment_id}/refunds", json={"amount": str(amount)})
    if res.status_code >= 400:
        raise PaymentGatewayError(res.json().get("code", f"HTTP_{res.status_code}"))
    return GatewayRefund(reference=res.json()["refund_reference"])
