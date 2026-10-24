import httpx

from app.config import settings


async def revoke(user_id: int, points: int) -> None:
    """ポイントサービスへ、注文で付与したポイントの取り消しを依頼する。"""
    async with httpx.AsyncClient(base_url=settings.points_base_url, timeout=5.0) as client:
        res = await client.post(f"/users/{user_id}/points/revoke", json={"points": points})
        res.raise_for_status()
