"""消費税率。請求担当が管理しているが、注文側も import している。"""
from decimal import Decimal

TAX_RATES = {
    "standard": Decimal("0.10"),
    "reduced": Decimal("0.08"),
}
