CREATE TABLE customers (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    -- 注文側が使う：配送先
    shipping_address TEXT,
    phone TEXT,
    -- 請求側が使う：請求先（法人の経理部門など、配送先とは別の相手）
    billing_name TEXT,
    billing_address TEXT,
    payment_terms_days INT DEFAULT 30,
    credit_limit NUMERIC(12, 0)
);

CREATE TABLE products (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    unit_price NUMERIC(12, 0) NOT NULL,
    tax_category TEXT NOT NULL DEFAULT 'standard'
);

CREATE TABLE stock (
    product_id BIGINT PRIMARY KEY REFERENCES products(id),
    quantity INT NOT NULL CHECK (quantity >= 0)
);

CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    status TEXT NOT NULL,          -- placed / paid / shipped / cancelled
    total_amount NUMERIC(12, 0) NOT NULL,
    tax_amount NUMERIC(12, 0) NOT NULL,
    placed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_lines (
    order_id BIGINT REFERENCES orders(id),
    product_id BIGINT REFERENCES products(id),
    quantity INT NOT NULL,
    unit_price NUMERIC(12, 0) NOT NULL
);

CREATE TABLE invoices (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id),
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    amount NUMERIC(12, 0) NOT NULL,
    tax_amount NUMERIC(12, 0) NOT NULL,
    due_date DATE NOT NULL,
    status TEXT NOT NULL           -- issued / paid / overdue / void
);

CREATE TABLE payments (
    id BIGSERIAL PRIMARY KEY,
    invoice_id BIGINT NOT NULL REFERENCES invoices(id),
    amount NUMERIC(12, 0) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL
);
