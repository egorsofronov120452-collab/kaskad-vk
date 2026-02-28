-- =============================================================
-- Kaskad VK — Миграция v2
-- Расширение схемы: сотрудники, каталог, заказы, такси,
-- журнал активности, отчёты, FSM-сессии клиентов, промокоды.
-- Полностью идемпотентный (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- =============================================================

-- ─── Расширение существующей таблицы users ───────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname      TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account  TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS site_password TEXT DEFAULT NULL;  -- bcrypt-хэш пароля для сайта
ALTER TABLE users ADD COLUMN IF NOT EXISTS site_role     TEXT DEFAULT NULL;  -- 'admin' | 'senior' | 'courier' | NULL

-- ─── 1. Справочник автомобилей ────────────────────────────────
CREATE TABLE IF NOT EXISTS cars (
  id         SERIAL PRIMARY KEY,
  name       TEXT    NOT NULL,
  photo_id   TEXT    DEFAULT NULL,  -- attachment id VK (photo{owner_id}_{id})
  is_org     BOOLEAN NOT NULL DEFAULT false,  -- TRUE = авто организации
  added_by   BIGINT  DEFAULT NULL,  -- vk_id добавившего (руководство)
  added_at   BIGINT  NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ─── 2. Профили сотрудников ───────────────────────────────────
-- Создаётся при регистрации в ЛС сообщества 1.
-- nickname и bank_account берутся из users (добавлены выше).
CREATE TABLE IF NOT EXISTS employees (
  vk_id          BIGINT PRIMARY KEY REFERENCES users(vk_id) ON DELETE CASCADE,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  registered_at   BIGINT  NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ─── 3. Автопарк сотрудника ───────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_cars (
  id           SERIAL PRIMARY KEY,
  employee_id  BIGINT  NOT NULL REFERENCES employees(vk_id) ON DELETE CASCADE,
  car_id       INT     NOT NULL REFERENCES cars(id) ON DELETE RESTRICT,
  is_org_car   BOOLEAN NOT NULL DEFAULT false,  -- взял авто организации
  is_colored   BOOLEAN NOT NULL DEFAULT false,  -- в цветах компании (→ 10% вместо 15%)
  photo_id     TEXT    DEFAULT NULL,            -- фото личного авто
  added_at     BIGINT  NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  UNIQUE (employee_id, car_id)
);

-- ─── 4. Категории товаров / сеты ──────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT    NOT NULL,
  type       TEXT    NOT NULL DEFAULT 'category' CHECK (type IN ('category', 'set')),
  parent_id  INT     DEFAULT NULL REFERENCES categories(id) ON DELETE SET NULL,
  photo_id   TEXT    DEFAULT NULL,
  sort_order INT     NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  added_by   BIGINT  DEFAULT NULL,
  added_at   BIGINT  NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- Начальная категория «Сеты» (если ещё нет)
INSERT INTO categories (name, type, sort_order)
  SELECT 'Сеты', 'category', 0
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Сеты' AND type = 'category');

-- ─── 5. Товары ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id           SERIAL PRIMARY KEY,
  category_id  INT     NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name         TEXT    NOT NULL,
  price        INT     NOT NULL,        -- стоимость для клиента (руб.)
  cost_price   INT     NOT NULL,        -- себестоимость (руб.)
  photo_id     TEXT    DEFAULT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  added_by     BIGINT  DEFAULT NULL,
  added_at     BIGINT  NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ─── 6. Компоненты товара (для курьера: что купить/приготовить) ─
CREATE TABLE IF NOT EXISTS product_components (
  id                  SERIAL PRIMARY KEY,
  product_id          INT  NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_name      TEXT NOT NULL,    -- например «Томат», «Мука», «Яйцо»
  quantity            INT  NOT NULL DEFAULT 1,
  instruction_photo   TEXT DEFAULT NULL -- фото-инструкция (attachment id VK)
);

-- ─── 7. Состав сета ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS set_items (
  id          SERIAL PRIMARY KEY,
  set_id      INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,  -- categories.type='set'
  product_id  INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    INT NOT NULL DEFAULT 1,
  UNIQUE (set_id, product_id)
);

-- ─── 8. Промокоды ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promo_codes (
  id           SERIAL PRIMARY KEY,
  code         TEXT    NOT NULL UNIQUE,
  discount_pct INT     NOT NULL CHECK (discount_pct BETWEEN 1 AND 100),
  max_uses     INT     DEFAULT NULL,   -- NULL = безлимит
  used_count   INT     NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   BIGINT  DEFAULT NULL,
  created_at   BIGINT  NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  expires_at   BIGINT  DEFAULT NULL
);

-- ─── 9. Заказы доставки ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_orders (
  id               SERIAL PRIMARY KEY,
  client_vk_id     BIGINT NOT NULL,
  nickname         TEXT   NOT NULL,    -- ник клиента (введённый вручную)
  delivery_place   TEXT   NOT NULL,    -- куда доставить
  courier_vk_id    BIGINT DEFAULT NULL,
  courier_eta      TEXT   DEFAULT NULL, -- «15 минут» и т.п.
  status           TEXT   NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','accepted','preparing','delivering','delivered','cancelled')),
  total_price      INT    NOT NULL,
  promo_code_id    INT    DEFAULT NULL REFERENCES promo_codes(id) ON DELETE SET NULL,
  -- id сообщения в чате диспетчерской (conversation_message_id)
  dispatch_cmid    BIGINT DEFAULT NULL,
  -- id редактируемого сообщения у клиента в ЛС сообщества 2
  client_msg_id    BIGINT DEFAULT NULL,
  created_at       BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  updated_at       BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ─── 10. Позиции заказа доставки ─────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INT  NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  product_id    INT  NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name  TEXT NOT NULL,  -- денормализовано (цена могла измениться)
  price         INT  NOT NULL,
  cost_price    INT  NOT NULL,
  quantity      INT  NOT NULL DEFAULT 1
);

-- ─── 11. Отметки курьера о покупке компонентов ───────────────
CREATE TABLE IF NOT EXISTS courier_component_checks (
  id             SERIAL PRIMARY KEY,
  order_id       INT     NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  component_name TEXT    NOT NULL,
  is_done        BOOLEAN NOT NULL DEFAULT false
);

-- ─── 12. Категории точек такси ────────────────────────────────
CREATE TABLE IF NOT EXISTS taxi_location_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,  -- «Авто», «Гос. учреждения», «ТЦ», ...
  sort_order INT  NOT NULL DEFAULT 0
);

-- ─── 13. Точки на карте такси ─────────────────────────────────
-- Координаты в пикселях на изображении карты (10×10 км).
CREATE TABLE IF NOT EXISTS taxi_locations (
  id           SERIAL PRIMARY KEY,
  name         TEXT    NOT NULL,
  category_id  INT     NOT NULL REFERENCES taxi_location_categories(id) ON DELETE RESTRICT,
  x_px         INT     NOT NULL,  -- пиксель X
  y_px         INT     NOT NULL,  -- пиксель Y
  is_active    BOOLEAN NOT NULL DEFAULT true,
  added_by     BIGINT  DEFAULT NULL,
  added_at     BIGINT  NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ─── 14. Заказы такси ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS taxi_orders (
  id                 SERIAL PRIMARY KEY,
  client_vk_id       BIGINT   NOT NULL,
  nickname           TEXT     NOT NULL,
  -- до 2 попутчиков (массив ников)
  passengers         TEXT[]   NOT NULL DEFAULT '{}',
  from_location_id   INT      DEFAULT NULL REFERENCES taxi_locations(id) ON DELETE SET NULL,
  from_custom        TEXT     DEFAULT NULL,  -- произвольный адрес (через сайт)
  to_location_id     INT      DEFAULT NULL REFERENCES taxi_locations(id) ON DELETE SET NULL,
  to_custom          TEXT     DEFAULT NULL,
  promo_code_id      INT      DEFAULT NULL REFERENCES promo_codes(id) ON DELETE SET NULL,
  payment_type       TEXT     NOT NULL CHECK (payment_type IN ('cash', 'bank')),
  payment_screenshot TEXT     DEFAULT NULL,  -- attachment id скрина оплаты
  base_price         INT      DEFAULT NULL,  -- рассчитанная стоимость без комиссии
  commission         INT      DEFAULT NULL,  -- комиссия (5% bank / 7% phone)
  final_price        INT      DEFAULT NULL,
  driver_vk_id       BIGINT   DEFAULT NULL,
  driver_eta         TEXT     DEFAULT NULL,
  status             TEXT     NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','waiting','in_progress','paid_wait','delivered','cancelled')),
  dispatch_cmid      BIGINT   DEFAULT NULL,  -- id сообщения в диспетчерской
  client_msg_id      BIGINT   DEFAULT NULL,  -- id редактируемого сообщения у клиента (ЛС сообщества 3)
  created_at         BIGINT   NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  updated_at         BIGINT   NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ─── 15. Журнал активности ────────────────────────────────────
-- Каждая запись = одна сессия (онлайн / афк / вышел).
CREATE TABLE IF NOT EXISTS activity_log (
  id            SERIAL PRIMARY KEY,
  vk_id         BIGINT NOT NULL REFERENCES users(vk_id) ON DELETE CASCADE,
  status        TEXT   NOT NULL CHECK (status IN ('online', 'afk', 'offline')),
  -- статус-текст: «доставка», «мероприятие», «экзамен», «Не у ПК», и т.д.
  activity_text TEXT   NOT NULL DEFAULT '',
  started_at    BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  ended_at      BIGINT DEFAULT NULL  -- NULL = текущая (открытая) сессия
);

-- Индекс для быстрого поиска открытой сессии сотрудника
CREATE INDEX IF NOT EXISTS idx_activity_log_open
  ON activity_log (vk_id)
  WHERE ended_at IS NULL;

-- ─── 16. Дневная агрегация онлайна (кэш) ─────────────────────
CREATE TABLE IF NOT EXISTS online_stats_daily (
  id            SERIAL PRIMARY KEY,
  vk_id         BIGINT NOT NULL REFERENCES users(vk_id) ON DELETE CASCADE,
  stat_date     DATE   NOT NULL,
  total_minutes INT    NOT NULL DEFAULT 0,
  UNIQUE (vk_id, stat_date)
);

-- ─── 17. Ежедневные отчёты ────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_reports (
  id              SERIAL PRIMARY KEY,
  report_date     DATE   NOT NULL UNIQUE,
  order_count     INT    NOT NULL DEFAULT 0,
  total_revenue   INT    NOT NULL DEFAULT 0,  -- общий оборот (стоимость)
  total_cost      INT    NOT NULL DEFAULT 0,  -- общая себестоимость
  -- [{vk_id, nickname, bank_account, amount}]
  courier_payouts JSONB  NOT NULL DEFAULT '[]',
  is_processed    BOOLEAN NOT NULL DEFAULT false,
  processed_at    BIGINT  DEFAULT NULL,
  processed_by    BIGINT  DEFAULT NULL,
  -- id сообщения в чате руководства (для кнопки «Обработано»)
  report_msg_cmid BIGINT  DEFAULT NULL,
  created_at      BIGINT  NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ─── 18. Еженедельные отчёты ──────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_reports (
  id              SERIAL PRIMARY KEY,
  week_start      DATE   NOT NULL UNIQUE,
  week_end        DATE   NOT NULL,
  -- [{date, order_count, total_revenue, courier_payouts}]
  daily_summary   JSONB  NOT NULL DEFAULT '[]',
  -- [{vk_id, nickname, bank_account, salary, income}]
  salary_payouts  JSONB  NOT NULL DEFAULT '[]',
  total_revenue   INT    NOT NULL DEFAULT 0,
  total_income    INT    NOT NULL DEFAULT 0,  -- доход организации
  is_processed    BOOLEAN NOT NULL DEFAULT false,
  processed_at    BIGINT  DEFAULT NULL,
  processed_by    BIGINT  DEFAULT NULL,
  report_msg_cmid BIGINT  DEFAULT NULL,
  created_at      BIGINT  NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ─── 19. FSM-сессии клиентов ──────────────────────────────────
-- Хранит текущее состояние диалога клиента в ЛС сообщества 2 или 3.
-- state-машина: main_menu → catalog / order / faq / employment
-- В order: cart → checkout_nick → checkout_place → confirm → waiting
CREATE TABLE IF NOT EXISTS client_sessions (
  vk_id       BIGINT NOT NULL,
  group_id    INT    NOT NULL,   -- 2 = доставка, 3 = такси
  state       TEXT   NOT NULL DEFAULT 'main_menu',
  -- корзина, выбранная категория, введённые данные и т.д.
  data        JSONB  NOT NULL DEFAULT '{}',
  -- id сообщения, которое редактируется в блоке «Заказать»
  message_id  BIGINT DEFAULT NULL,
  updated_at  BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  PRIMARY KEY (vk_id, group_id)
);

-- ─── 20. Запросы на обмен ВК-ссылками ────────────────────────
-- Клиент запрашивает ссылку на курьера или наоборот.
CREATE TABLE IF NOT EXISTS contact_requests (
  id           SERIAL PRIMARY KEY,
  order_id     INT    NOT NULL,
  order_type   TEXT   NOT NULL CHECK (order_type IN ('delivery', 'taxi')),
  requester_id BIGINT NOT NULL,  -- кто запрашивает
  target_id    BIGINT NOT NULL,  -- у кого запрашивают
  status       TEXT   NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at   BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- ─── Вспомогательные индексы ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_delivery_orders_client   ON delivery_orders (client_vk_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_courier  ON delivery_orders (courier_vk_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status   ON delivery_orders (status);
CREATE INDEX IF NOT EXISTS idx_taxi_orders_client       ON taxi_orders (client_vk_id);
CREATE INDEX IF NOT EXISTS idx_taxi_orders_driver       ON taxi_orders (driver_vk_id);
CREATE INDEX IF NOT EXISTS idx_taxi_orders_status       ON taxi_orders (status);
CREATE INDEX IF NOT EXISTS idx_activity_log_vk_date     ON activity_log (vk_id, started_at);
CREATE INDEX IF NOT EXISTS idx_products_category        ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_employee_cars_employee   ON employee_cars (employee_id);
CREATE INDEX IF NOT EXISTS idx_client_sessions_state    ON client_sessions (state);
