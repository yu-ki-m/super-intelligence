import httpx

from app.config import settings
from app.schemas import RefundItem


async def restock(items: list[RefundItem]) -> None:
    """在庫サービスへ返品分の在庫戻しを依頼する。"""
    async with httpx.AsyncClient(base_url=settings.inventory_base_url, timeout=5.0) as client:
        res = await client.post("/stocks/restock", json=[{"product_id": i.product_id, "quantity": i.quantity} for i in items])
        res.raise_for_status()
