"""Order placement and cancellation."""
from datetime import date, timedelta
from decimal import Decimal, ROUND_FLOOR

from shared.db import transaction
from billing.tax import TAX_RATES


def place_order(customer_id, lines):
    """注文を確定する。在庫を引き当て、請求書も同時に発行する。"""
    with transaction() as conn:
        subtotal = Decimal(0)
        tax = Decimal(0)
        priced = []
        for line in lines:
            unit_price, tax_category = conn.execute(
                "SELECT unit_price, tax_category FROM products WHERE id = %s",
                (line["product_id"],),
            ).fetchone()
            amount = unit_price * line["quantity"]
            subtotal += amount
            # 消費税の計算（端数は行ごとに切り捨て）
            tax += (amount * TAX_RATES[tax_category]).quantize(Decimal(1), ROUND_FLOOR)
            conn.execute(
                "UPDATE stock SET quantity = quantity - %s WHERE product_id = %s",
                (line["quantity"], line["product_id"]),
            )
            priced.append((line["product_id"], line["quantity"], unit_price))
        order_id = conn.execute(
            "INSERT INTO orders (customer_id, status, total_amount, tax_amount)"
            " VALUES (%s, 'placed', %s, %s) RETURNING id",
            (customer_id, subtotal + tax, tax),
        ).fetchone()[0]
        for product_id, quantity, unit_price in priced:
            conn.execute(
                "INSERT INTO order_lines VALUES (%s, %s, %s, %s)",
                (order_id, product_id, quantity, unit_price),
            )
        # 請求書の発行（請求側の関数を呼ばず、invoices に直接 INSERT している）
        terms = conn.execute(
            "SELECT payment_terms_days FROM customers WHERE id = %s", (customer_id,)
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO invoices (order_id, customer_id, amount, tax_amount, due_date, status)"
            " VALUES (%s, %s, %s, %s, %s, 'issued')",
            (order_id, customer_id, subtotal + tax, tax, date.today() + timedelta(days=terms)),
        )
        return order_id


def cancel_order(order_id):
    """注文を取り消す。在庫を戻し、請求書を無効にする。"""
    with transaction() as conn:
        status = conn.execute(
            "SELECT status FROM orders WHERE id = %s", (order_id,)
        ).fetchone()[0]
        if status == "shipped":
            raise ValueError("出荷済みの注文は取り消せない")
        lines = conn.execute(
            "SELECT product_id, quantity FROM order_lines WHERE order_id = %s", (order_id,)
        ).fetchall()
        for product_id, quantity in lines:
            conn.execute(
                "UPDATE stock SET quantity = quantity + %s WHERE product_id = %s",
                (quantity, product_id),
            )
        conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = %s", (order_id,))
        conn.execute("UPDATE invoices SET status = 'void' WHERE order_id = %s", (order_id,))
