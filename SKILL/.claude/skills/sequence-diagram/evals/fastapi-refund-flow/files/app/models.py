import enum
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class OrderStatus(str, enum.Enum):
    PAID = "PAID"
    SHIPPED = "SHIPPED"
    DELIVERED = "DELIVERED"
    REFUNDED = "REFUNDED"


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[OrderStatus] = mapped_column(String(20))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 0))
    payment_id: Mapped[str] = mapped_column(String(64))
    earned_points: Mapped[int]
    lines: Mapped[list["OrderLine"]] = relationship()


class OrderLine(Base):
    __tablename__ = "order_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"))
    product_id: Mapped[str] = mapped_column(String(32))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 0))
    quantity: Mapped[int]


class Refund(Base):
    __tablename__ = "refunds"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 0))
    reason: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20))
    failure_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    gateway_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    action: Mapped[str] = mapped_column(String(40))
    order_id: Mapped[int]
