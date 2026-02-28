import { neon } from '@neondatabase/serverless';
import { formatBanEndDate } from './utils';

const sql = neon(process.env.DATABASE_URL!);

// ============= BLACKLIST =============

export interface BanInfo {
  endDate: number;
  reason: string;
  bannedAt: number;
  bannedBy: number | null;
}

export async function isUserInBlacklist(userId: number): Promise<BanInfo | null> {
  const rows = await sql`
    SELECT end_date, reason, banned_at, banned_by
    FROM blacklist
    WHERE user_id = ${userId}
  `;
  if (!rows.length) return null;

  const row = rows[0] as any;
  const ban: BanInfo = {
    endDate:  Number(row.end_date),
    reason:   row.reason,
    bannedAt: Number(row.banned_at),
    bannedBy: row.banned_by ? Number(row.banned_by) : null,
  };

  // Перманентный бан
  if (ban.endDate === 0) return ban;

  // Временный бан истёк — удаляем
  if (ban.endDate <= Date.now()) {
    await removeFromBlacklist(userId);
    return null;
  }

  return ban;
}

export async function addToBlacklist(
  userId: number,
  days: number,
  reason = 'Нарушение правил',
  bannedBy: number | null = null,
) {
  const now = Date.now();
  const endDate = days === 0 || days === 999 ? 0 : now + days * 24 * 60 * 60 * 1000;

  await sql`
    INSERT INTO blacklist (user_id, end_date, reason, banned_at, banned_by)
    VALUES (${userId}, ${endDate}, ${reason}, ${now}, ${bannedBy})
    ON CONFLICT (user_id) DO UPDATE
      SET end_date  = EXCLUDED.end_date,
          reason    = EXCLUDED.reason,
          banned_at = EXCLUDED.banned_at,
          banned_by = EXCLUDED.banned_by
  `;
}

export async function removeFromBlacklist(userId: number): Promise<boolean> {
  const result = await sql`DELETE FROM blacklist WHERE user_id = ${userId}`;
  return (result as any).count > 0;
}

export async function getAllBlacklist(): Promise<(BanInfo & { userId: number })[]> {
  const rows = await sql`SELECT * FROM blacklist ORDER BY banned_at DESC`;
  const now = Date.now();
  return (rows as any[])
    .filter(r => Number(r.end_date) === 0 || Number(r.end_date) > now)
    .map(r => ({
      userId:   Number(r.user_id),
      endDate:  Number(r.end_date),
      reason:   r.reason,
      bannedAt: Number(r.banned_at),
      bannedBy: r.banned_by ? Number(r.banned_by) : null,
    }));
}

// ============= MUTES =============

export interface MuteInfo {
  endDate: number;
  reason: string;
  mutedAt: number;
  mutedBy: number | null;
}

export async function isUserMuted(userId: number): Promise<MuteInfo | null> {
  const rows = await sql`
    SELECT end_date, reason, muted_at, muted_by
    FROM mutes
    WHERE user_id = ${userId}
  `;
  if (!rows.length) return null;

  const row = rows[0] as any;
  const mute: MuteInfo = {
    endDate: Number(row.end_date),
    reason:  row.reason,
    mutedAt: Number(row.muted_at),
    mutedBy: row.muted_by ? Number(row.muted_by) : null,
  };

  if (mute.endDate <= Date.now()) {
    await removeMute(userId);
    return null;
  }

  return mute;
}

export async function addMute(
  userId: number,
  minutes: number,
  reason: string,
  mutedBy: number | null,
) {
  const now = Date.now();
  const endDate = now + minutes * 60 * 1000;

  await sql`
    INSERT INTO mutes (user_id, end_date, reason, muted_at, muted_by)
    VALUES (${userId}, ${endDate}, ${reason}, ${now}, ${mutedBy})
    ON CONFLICT (user_id) DO UPDATE
      SET end_date = EXCLUDED.end_date,
          reason   = EXCLUDED.reason,
          muted_at = EXCLUDED.muted_at,
          muted_by = EXCLUDED.muted_by
  `;
}

export async function removeMute(userId: number): Promise<boolean> {
  const result = await sql`DELETE FROM mutes WHERE user_id = ${userId}`;
  return (result as any).count > 0;
}

// ============= GREETINGS =============

export interface Greeting {
  text: string;
  attachments: string[];
}

export async function getGreeting(peerId: number): Promise<Greeting | null> {
  const rows = await sql`SELECT text, attachments FROM greetings WHERE peer_id = ${peerId}`;
  if (!rows.length) return null;
  const row = rows[0] as any;
  return {
    text:        row.text,
    attachments: JSON.parse(row.attachments || '[]'),
  };
}

export async function setGreeting(peerId: number, text: string, attachments: string[]) {
  await sql`
    INSERT INTO greetings (peer_id, text, attachments)
    VALUES (${peerId}, ${text}, ${JSON.stringify(attachments)})
    ON CONFLICT (peer_id) DO UPDATE
      SET text        = EXCLUDED.text,
          attachments = EXCLUDED.attachments
  `;
}

// ============= USERS (extended) =============

export async function upsertUser(vkId: number, firstName: string, lastName: string) {
  const now = Date.now();
  await sql`
    INSERT INTO users (vk_id, first_name, last_name, joined_at, updated_at)
    VALUES (${vkId}, ${firstName}, ${lastName}, ${now}, ${now})
    ON CONFLICT (vk_id) DO UPDATE
      SET first_name = EXCLUDED.first_name,
          last_name  = EXCLUDED.last_name,
          updated_at = ${now}
  `;
}

export async function getUserByVkId(vkId: number) {
  const rows = await sql`SELECT * FROM users WHERE vk_id = ${vkId}`;
  return rows[0] as any | null;
}

export async function setUserNickname(vkId: number, nickname: string) {
  await sql`UPDATE users SET nickname = ${nickname}, updated_at = ${Date.now()} WHERE vk_id = ${vkId}`;
}

export async function setUserBankAccount(vkId: number, account: string) {
  await sql`UPDATE users SET bank_account = ${account}, updated_at = ${Date.now()} WHERE vk_id = ${vkId}`;
}

export async function setUserSitePassword(vkId: number, passwordHash: string) {
  await sql`UPDATE users SET site_password = ${passwordHash}, updated_at = ${Date.now()} WHERE vk_id = ${vkId}`;
}

// ============= EMPLOYEES =============

export interface Employee {
  vkId: number;
  isActive: boolean;
  registeredAt: number;
  nickname: string | null;
  bankAccount: string | null;
  siteRole: string | null;
  role: string | null;
}

export async function registerEmployee(vkId: number) {
  await sql`
    INSERT INTO employees (vk_id, registered_at)
    VALUES (${vkId}, ${Date.now()})
    ON CONFLICT (vk_id) DO NOTHING
  `;
}

export async function getEmployee(vkId: number): Promise<Employee | null> {
  const rows = await sql`
    SELECT e.vk_id, e.is_active, e.registered_at,
           u.nickname, u.bank_account, u.site_role, u.role
    FROM employees e
    JOIN users u ON u.vk_id = e.vk_id
    WHERE e.vk_id = ${vkId}
  `;
  if (!rows.length) return null;
  const r = rows[0] as any;
  return {
    vkId:        Number(r.vk_id),
    isActive:    r.is_active,
    registeredAt: Number(r.registered_at),
    nickname:    r.nickname,
    bankAccount: r.bank_account,
    siteRole:    r.site_role,
    role:        r.role,
  };
}

export async function getAllEmployees(): Promise<Employee[]> {
  const rows = await sql`
    SELECT e.vk_id, e.is_active, e.registered_at,
           u.nickname, u.bank_account, u.site_role, u.role
    FROM employees e
    JOIN users u ON u.vk_id = e.vk_id
    ORDER BY e.registered_at ASC
  `;
  return (rows as any[]).map(r => ({
    vkId:        Number(r.vk_id),
    isActive:    r.is_active,
    registeredAt: Number(r.registered_at),
    nickname:    r.nickname,
    bankAccount: r.bank_account,
    siteRole:    r.site_role,
    role:        r.role,
  }));
}

// ============= CARS =============

export interface Car {
  id: number;
  name: string;
  photoId: string | null;
  isOrg: boolean;
  addedBy: number | null;
  addedAt: number;
}

export async function addCar(name: string, photoId: string | null, isOrg: boolean, addedBy: number): Promise<Car> {
  const rows = await sql`
    INSERT INTO cars (name, photo_id, is_org, added_by, added_at)
    VALUES (${name}, ${photoId}, ${isOrg}, ${addedBy}, ${Date.now()})
    RETURNING *
  `;
  const r = rows[0] as any;
  return { id: r.id, name: r.name, photoId: r.photo_id, isOrg: r.is_org, addedBy: r.added_by, addedAt: Number(r.added_at) };
}

export async function getAllCars(orgOnly = false): Promise<Car[]> {
  const rows = orgOnly
    ? await sql`SELECT * FROM cars WHERE is_org = true ORDER BY name`
    : await sql`SELECT * FROM cars ORDER BY name`;
  return (rows as any[]).map(r => ({ id: r.id, name: r.name, photoId: r.photo_id, isOrg: r.is_org, addedBy: r.added_by, addedAt: Number(r.added_at) }));
}

export async function getEmployeeCars(vkId: number) {
  const rows = await sql`
    SELECT ec.*, c.name AS car_name, c.photo_id AS car_photo
    FROM employee_cars ec
    JOIN cars c ON c.id = ec.car_id
    WHERE ec.employee_id = ${vkId}
    ORDER BY ec.added_at ASC
  `;
  return rows as any[];
}

export async function addEmployeeCar(
  employeeId: number,
  carId: number,
  isOrgCar: boolean,
  isColored: boolean,
  photoId: string | null,
) {
  await sql`
    INSERT INTO employee_cars (employee_id, car_id, is_org_car, is_colored, photo_id, added_at)
    VALUES (${employeeId}, ${carId}, ${isOrgCar}, ${isColored}, ${photoId}, ${Date.now()})
    ON CONFLICT (employee_id, car_id) DO NOTHING
  `;
}

// ============= CATEGORIES =============

export interface Category {
  id: number;
  name: string;
  type: 'category' | 'set';
  parentId: number | null;
  photoId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export async function getCategories(parentId?: number | null): Promise<Category[]> {
  const rows = parentId != null
    ? await sql`SELECT * FROM categories WHERE parent_id = ${parentId} AND is_active = true ORDER BY sort_order, name`
    : await sql`SELECT * FROM categories WHERE parent_id IS NULL AND is_active = true ORDER BY sort_order, name`;
  return (rows as any[]).map(r => ({
    id: r.id, name: r.name, type: r.type,
    parentId: r.parent_id, photoId: r.photo_id,
    sortOrder: r.sort_order, isActive: r.is_active,
  }));
}

export async function getCategoryById(id: number): Promise<Category | null> {
  const rows = await sql`SELECT * FROM categories WHERE id = ${id}`;
  if (!rows.length) return null;
  const r = rows[0] as any;
  return { id: r.id, name: r.name, type: r.type, parentId: r.parent_id, photoId: r.photo_id, sortOrder: r.sort_order, isActive: r.is_active };
}

export async function createCategory(
  name: string, type: 'category' | 'set', parentId: number | null, photoId: string | null, addedBy: number,
): Promise<Category> {
  const rows = await sql`
    INSERT INTO categories (name, type, parent_id, photo_id, added_by, added_at)
    VALUES (${name}, ${type}, ${parentId}, ${photoId}, ${addedBy}, ${Date.now()})
    RETURNING *
  `;
  const r = rows[0] as any;
  return { id: r.id, name: r.name, type: r.type, parentId: r.parent_id, photoId: r.photo_id, sortOrder: r.sort_order, isActive: r.is_active };
}

// ============= PRODUCTS =============

export interface Product {
  id: number;
  categoryId: number;
  name: string;
  price: number;
  costPrice: number;
  photoId: string | null;
  isActive: boolean;
}

export async function getProductsByCategory(categoryId: number): Promise<Product[]> {
  const rows = await sql`
    SELECT * FROM products WHERE category_id = ${categoryId} AND is_active = true ORDER BY name
  `;
  return (rows as any[]).map(r => ({
    id: r.id, categoryId: r.category_id, name: r.name,
    price: r.price, costPrice: r.cost_price,
    photoId: r.photo_id, isActive: r.is_active,
  }));
}

export async function getProductById(id: number): Promise<Product | null> {
  const rows = await sql`SELECT * FROM products WHERE id = ${id}`;
  if (!rows.length) return null;
  const r = rows[0] as any;
  return { id: r.id, categoryId: r.category_id, name: r.name, price: r.price, costPrice: r.cost_price, photoId: r.photo_id, isActive: r.is_active };
}

export async function createProduct(
  categoryId: number, name: string, price: number, costPrice: number, photoId: string | null, addedBy: number,
): Promise<Product> {
  const rows = await sql`
    INSERT INTO products (category_id, name, price, cost_price, photo_id, added_by, added_at)
    VALUES (${categoryId}, ${name}, ${price}, ${costPrice}, ${photoId}, ${addedBy}, ${Date.now()})
    RETURNING *
  `;
  const r = rows[0] as any;
  return { id: r.id, categoryId: r.category_id, name: r.name, price: r.price, costPrice: r.cost_price, photoId: r.photo_id, isActive: r.is_active };
}

export async function getProductComponents(productId: number) {
  const rows = await sql`SELECT * FROM product_components WHERE product_id = ${productId} ORDER BY id`;
  return rows as any[];
}

// ============= PROMO CODES =============

export async function getPromoCode(code: string) {
  const rows = await sql`
    SELECT * FROM promo_codes
    WHERE code = ${code.toUpperCase()} AND is_active = true
      AND (max_uses IS NULL OR used_count < max_uses)
      AND (expires_at IS NULL OR expires_at > ${Date.now()})
  `;
  return rows[0] as any | null;
}

export async function incrementPromoUsage(id: number) {
  await sql`UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ${id}`;
}

export async function createPromoCode(
  code: string, discountPct: number, maxUses: number | null, createdBy: number, expiresAt: number | null,
) {
  await sql`
    INSERT INTO promo_codes (code, discount_pct, max_uses, created_by, created_at, expires_at)
    VALUES (${code.toUpperCase()}, ${discountPct}, ${maxUses}, ${createdBy}, ${Date.now()}, ${expiresAt})
  `;
}

// ============= CLIENT SESSIONS (FSM) =============

export interface ClientSession {
  vkId: number;
  groupId: number;
  state: string;
  data: Record<string, any>;
  messageId: number | null;
  updatedAt: number;
}

export async function getClientSession(vkId: number, groupId: number): Promise<ClientSession | null> {
  const rows = await sql`SELECT * FROM client_sessions WHERE vk_id = ${vkId} AND group_id = ${groupId}`;
  if (!rows.length) return null;
  const r = rows[0] as any;
  return {
    vkId: Number(r.vk_id), groupId: r.group_id, state: r.state,
    data: r.data, messageId: r.message_id ? Number(r.message_id) : null,
    updatedAt: Number(r.updated_at),
  };
}

export async function upsertClientSession(
  vkId: number, groupId: number, state: string, data: Record<string, any>, messageId?: number | null,
) {
  const now = Date.now();
  await sql`
    INSERT INTO client_sessions (vk_id, group_id, state, data, message_id, updated_at)
    VALUES (${vkId}, ${groupId}, ${state}, ${JSON.stringify(data)}, ${messageId ?? null}, ${now})
    ON CONFLICT (vk_id, group_id) DO UPDATE
      SET state      = EXCLUDED.state,
          data       = EXCLUDED.data,
          message_id = EXCLUDED.message_id,
          updated_at = ${now}
  `;
}

export async function deleteClientSession(vkId: number, groupId: number) {
  await sql`DELETE FROM client_sessions WHERE vk_id = ${vkId} AND group_id = ${groupId}`;
}

// ============= DELIVERY ORDERS =============

export interface DeliveryOrderItem {
  productId: number;
  productName: string;
  price: number;
  costPrice: number;
  quantity: number;
}

export async function createDeliveryOrder(
  clientVkId: number,
  nickname: string,
  deliveryPlace: string,
  items: DeliveryOrderItem[],
  totalPrice: number,
  promoCodeId: number | null,
  clientMsgId: number | null,
): Promise<number> {
  const now = Date.now();
  const orderRows = await sql`
    INSERT INTO delivery_orders (client_vk_id, nickname, delivery_place, total_price, promo_code_id, client_msg_id, created_at, updated_at)
    VALUES (${clientVkId}, ${nickname}, ${deliveryPlace}, ${totalPrice}, ${promoCodeId}, ${clientMsgId}, ${now}, ${now})
    RETURNING id
  `;
  const orderId = (orderRows[0] as any).id;

  for (const item of items) {
    await sql`
      INSERT INTO delivery_order_items (order_id, product_id, product_name, price, cost_price, quantity)
      VALUES (${orderId}, ${item.productId}, ${item.productName}, ${item.price}, ${item.costPrice}, ${item.quantity})
    `;
  }
  return orderId;
}

export async function getDeliveryOrder(orderId: number) {
  const rows = await sql`SELECT * FROM delivery_orders WHERE id = ${orderId}`;
  return rows[0] as any | null;
}

export async function getDeliveryOrderItems(orderId: number): Promise<DeliveryOrderItem[]> {
  const rows = await sql`SELECT * FROM delivery_order_items WHERE order_id = ${orderId} ORDER BY id`;
  return (rows as any[]).map(r => ({
    productId: r.product_id, productName: r.product_name,
    price: r.price, costPrice: r.cost_price, quantity: r.quantity,
  }));
}

export async function updateDeliveryOrderStatus(
  orderId: number, status: string, extra?: { courierVkId?: number; courierEta?: string; dispatchCmid?: number; clientMsgId?: number },
) {
  const now = Date.now();
  await sql`
    UPDATE delivery_orders
    SET status       = ${status},
        updated_at   = ${now},
        courier_vk_id  = COALESCE(${extra?.courierVkId ?? null}, courier_vk_id),
        courier_eta    = COALESCE(${extra?.courierEta ?? null}, courier_eta),
        dispatch_cmid  = COALESCE(${extra?.dispatchCmid ?? null}, dispatch_cmid),
        client_msg_id  = COALESCE(${extra?.clientMsgId ?? null}, client_msg_id)
    WHERE id = ${orderId}
  `;
}

// ============= TAXI ORDERS =============

export async function createTaxiOrder(params: {
  clientVkId: number;
  nickname: string;
  passengers: string[];
  fromLocationId: number | null;
  fromCustom: string | null;
  toLocationId: number | null;
  toCustom: string | null;
  promoCodeId: number | null;
  paymentType: 'cash' | 'bank';
  basePrice: number | null;
  commission: number | null;
  finalPrice: number | null;
  clientMsgId: number | null;
}): Promise<number> {
  const now = Date.now();
  const rows = await sql`
    INSERT INTO taxi_orders (
      client_vk_id, nickname, passengers,
      from_location_id, from_custom, to_location_id, to_custom,
      promo_code_id, payment_type,
      base_price, commission, final_price,
      client_msg_id, created_at, updated_at
    ) VALUES (
      ${params.clientVkId}, ${params.nickname}, ${params.passengers},
      ${params.fromLocationId}, ${params.fromCustom}, ${params.toLocationId}, ${params.toCustom},
      ${params.promoCodeId}, ${params.paymentType},
      ${params.basePrice}, ${params.commission}, ${params.finalPrice},
      ${params.clientMsgId}, ${now}, ${now}
    ) RETURNING id
  `;
  return (rows[0] as any).id;
}

export async function getTaxiOrder(orderId: number) {
  const rows = await sql`SELECT * FROM taxi_orders WHERE id = ${orderId}`;
  return rows[0] as any | null;
}

export async function updateTaxiOrderStatus(
  orderId: number, status: string,
  extra?: { driverVkId?: number; driverEta?: string; dispatchCmid?: number; clientMsgId?: number; paymentScreenshot?: string },
) {
  const now = Date.now();
  await sql`
    UPDATE taxi_orders
    SET status              = ${status},
        updated_at          = ${now},
        driver_vk_id        = COALESCE(${extra?.driverVkId ?? null}, driver_vk_id),
        driver_eta          = COALESCE(${extra?.driverEta ?? null}, driver_eta),
        dispatch_cmid       = COALESCE(${extra?.dispatchCmid ?? null}, dispatch_cmid),
        client_msg_id       = COALESCE(${extra?.clientMsgId ?? null}, client_msg_id),
        payment_screenshot  = COALESCE(${extra?.paymentScreenshot ?? null}, payment_screenshot)
    WHERE id = ${orderId}
  `;
}

// ============= TAXI LOCATIONS =============

export async function getTaxiLocationCategories() {
  const rows = await sql`SELECT * FROM taxi_location_categories ORDER BY sort_order, name`;
  return rows as any[];
}

export async function getTaxiLocationsByCategory(categoryId: number) {
  const rows = await sql`
    SELECT * FROM taxi_locations WHERE category_id = ${categoryId} AND is_active = true ORDER BY name
  `;
  return rows as any[];
}

export async function getTaxiLocationById(id: number) {
  const rows = await sql`SELECT * FROM taxi_locations WHERE id = ${id}`;
  return rows[0] as any | null;
}

export async function createTaxiLocation(
  name: string, categoryId: number, xPx: number, yPx: number, addedBy: number,
) {
  await sql`
    INSERT INTO taxi_locations (name, category_id, x_px, y_px, added_by, added_at)
    VALUES (${name}, ${categoryId}, ${xPx}, ${yPx}, ${addedBy}, ${Date.now()})
  `;
}

export async function createTaxiLocationCategory(name: string, sortOrder = 0) {
  await sql`
    INSERT INTO taxi_location_categories (name, sort_order)
    VALUES (${name}, ${sortOrder})
    ON CONFLICT (name) DO NOTHING
  `;
}

// ============= ACTIVITY LOG =============

export async function openActivitySession(vkId: number, status: 'online' | 'afk', activityText: string) {
  const now = Date.now();
  // Закрываем предыдущую открытую сессию
  await sql`
    UPDATE activity_log SET ended_at = ${now}
    WHERE vk_id = ${vkId} AND ended_at IS NULL
  `;
  await sql`
    INSERT INTO activity_log (vk_id, status, activity_text, started_at)
    VALUES (${vkId}, ${status}, ${activityText}, ${now})
  `;
}

export async function closeActivitySession(vkId: number) {
  const now = Date.now();
  // Подсчёт минут закрываемой сессии и запись в дневную агрегацию
  const rows = await sql`
    UPDATE activity_log SET ended_at = ${now}
    WHERE vk_id = ${vkId} AND ended_at IS NULL
    RETURNING started_at
  `;
  if (rows.length) {
    const startedAt = Number((rows[0] as any).started_at);
    const minutes = Math.floor((now - startedAt) / 60000);
    if (minutes > 0) {
      const today = new Date().toISOString().slice(0, 10);
      await sql`
        INSERT INTO online_stats_daily (vk_id, stat_date, total_minutes)
        VALUES (${vkId}, ${today}, ${minutes})
        ON CONFLICT (vk_id, stat_date) DO UPDATE
          SET total_minutes = online_stats_daily.total_minutes + ${minutes}
      `;
    }
  }
}

export async function getCurrentOnlineList() {
  const rows = await sql`
    SELECT al.vk_id, al.status, al.activity_text, al.started_at,
           u.nickname, u.role
    FROM activity_log al
    JOIN users u ON u.vk_id = al.vk_id
    WHERE al.ended_at IS NULL
    ORDER BY al.started_at ASC
  `;
  return rows as any[];
}

export async function getOnlineStatsForUser(vkId: number, days = 7) {
  const rows = await sql`
    SELECT stat_date, total_minutes
    FROM online_stats_daily
    WHERE vk_id = ${vkId}
      AND stat_date >= CURRENT_DATE - ${days}::INT
    ORDER BY stat_date DESC
  `;
  return rows as any[];
}

export async function getOnlineRankThisWeek(vkId: number): Promise<number> {
  const rows = await sql`
    SELECT vk_id, SUM(total_minutes) AS total
    FROM online_stats_daily
    WHERE stat_date >= DATE_TRUNC('week', CURRENT_DATE)
    GROUP BY vk_id
    ORDER BY total DESC
  `;
  const rank = (rows as any[]).findIndex(r => Number(r.vk_id) === vkId);
  return rank === -1 ? 0 : rank + 1;
}

// ============= DAILY / WEEKLY REPORTS =============

export async function getOrCreateDailyReport(date: string) {
  let rows = await sql`SELECT * FROM daily_reports WHERE report_date = ${date}`;
  if (!rows.length) {
    rows = await sql`
      INSERT INTO daily_reports (report_date, created_at)
      VALUES (${date}, ${Date.now()})
      RETURNING *
    `;
  }
  return rows[0] as any;
}

export async function updateDailyReport(
  date: string,
  orderCount: number,
  totalRevenue: number,
  totalCost: number,
  courierPayouts: object[],
  reportMsgCmid?: number,
) {
  await sql`
    UPDATE daily_reports
    SET order_count     = ${orderCount},
        total_revenue   = ${totalRevenue},
        total_cost      = ${totalCost},
        courier_payouts = ${JSON.stringify(courierPayouts)},
        report_msg_cmid = COALESCE(${reportMsgCmid ?? null}, report_msg_cmid)
    WHERE report_date = ${date}
  `;
}

export async function markDailyReportProcessed(date: string, processedBy: number) {
  await sql`
    UPDATE daily_reports
    SET is_processed = true, processed_at = ${Date.now()}, processed_by = ${processedBy}
    WHERE report_date = ${date}
  `;
}

export async function getWeeklyReportData(weekStart: string) {
  const rows = await sql`SELECT * FROM weekly_reports WHERE week_start = ${weekStart}`;
  return rows[0] as any | null;
}

export async function upsertWeeklyReport(
  weekStart: string, weekEnd: string,
  dailySummary: object[], salaryPayouts: object[],
  totalRevenue: number, totalIncome: number,
  reportMsgCmid?: number,
) {
  const now = Date.now();
  await sql`
    INSERT INTO weekly_reports (week_start, week_end, daily_summary, salary_payouts, total_revenue, total_income, report_msg_cmid, created_at)
    VALUES (${weekStart}, ${weekEnd}, ${JSON.stringify(dailySummary)}, ${JSON.stringify(salaryPayouts)}, ${totalRevenue}, ${totalIncome}, ${reportMsgCmid ?? null}, ${now})
    ON CONFLICT (week_start) DO UPDATE
      SET week_end        = EXCLUDED.week_end,
          daily_summary   = EXCLUDED.daily_summary,
          salary_payouts  = EXCLUDED.salary_payouts,
          total_revenue   = EXCLUDED.total_revenue,
          total_income    = EXCLUDED.total_income,
          report_msg_cmid = COALESCE(EXCLUDED.report_msg_cmid, weekly_reports.report_msg_cmid)
  `;
}

export async function markWeeklyReportProcessed(weekStart: string, processedBy: number) {
  await sql`
    UPDATE weekly_reports
    SET is_processed = true, processed_at = ${Date.now()}, processed_by = ${processedBy}
    WHERE week_start = ${weekStart}
  `;
}

// ============= CONTACT REQUESTS =============

export async function createContactRequest(
  orderId: number, orderType: 'delivery' | 'taxi', requesterId: number, targetId: number,
): Promise<number> {
  const rows = await sql`
    INSERT INTO contact_requests (order_id, order_type, requester_id, target_id, created_at)
    VALUES (${orderId}, ${orderType}, ${requesterId}, ${targetId}, ${Date.now()})
    RETURNING id
  `;
  return (rows[0] as any).id;
}

export async function updateContactRequestStatus(id: number, status: 'approved' | 'rejected') {
  await sql`UPDATE contact_requests SET status = ${status} WHERE id = ${id}`;
}

export async function getPendingContactRequest(id: number) {
  const rows = await sql`SELECT * FROM contact_requests WHERE id = ${id} AND status = 'pending'`;
  return rows[0] as any | null;
}
