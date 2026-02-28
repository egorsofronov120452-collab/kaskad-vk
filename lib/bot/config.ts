// Конфигурация VK бота

export const VK_API_VERSION = '5.131';

// Группа 1 — сотрудники (главный бот в чатах)
export const VK_GROUP1_TOKEN = process.env.VK_GROUP1_TOKEN!;
export const VK_GROUP1_ID    = process.env.VK_GROUP1_ID!;

// Группа 2 — клиентский бот доставки
export const VK_GROUP2_TOKEN = process.env.VK_GROUP2_TOKEN!;
export const VK_GROUP2_ID    = process.env.VK_GROUP2_ID!;

// Группа 3 — бот такси
export const VK_GROUP3_TOKEN = process.env.VK_GROUP3_TOKEN!;
export const VK_GROUP3_ID    = process.env.VK_GROUP3_ID!;

export const VK_USER_TOKEN   = process.env.VK_USER_TOKEN;

// Callback secrets (у каждой группы свой секрет и токен подтверждения)
export const VK_CALLBACK_SECRET    = process.env.VK_CALLBACK_SECRET!;    // группа 1
export const VK_CONFIRMATION_TOKEN = process.env.VK_CONFIRMATION_TOKEN!; // группа 1
export const VK_CALLBACK_SECRET2    = process.env.VK_CALLBACK_SECRET2!;   // группа 2
export const VK_CONFIRMATION_TOKEN2 = process.env.VK_CONFIRMATION_TOKEN2!;// группа 2
export const VK_CALLBACK_SECRET3    = process.env.VK_CALLBACK_SECRET3!;   // группа 3
export const VK_CONFIRMATION_TOKEN3 = process.env.VK_CONFIRMATION_TOKEN3!;// группа 3

// ─── Карта такси ──────────────────────────────────────────────
// Карта — квадрат 10×10 км, изображение заданных размеров.
// Реальное расстояние = sqrt((dx_px/MAP_PX_PER_KM)² + (dy_px/MAP_PX_PER_KM)²) км
export const TAXI_MAP_SIZE_KM   = 10;
export const TAXI_MAP_IMAGE_URL = process.env.TAXI_MAP_IMAGE_URL || 'https://cdn.imgchest.com/files/c7419c8a011b.jpg';
export const TAXI_BASE_PRICE_PER_KM = parseInt(process.env.TAXI_BASE_PRICE_PER_KM || '50'); // руб/км
// Изображение карты считается квадратным; ширина в пикселях задаётся энвом
export const TAXI_MAP_IMAGE_PX  = parseInt(process.env.TAXI_MAP_IMAGE_PX || '1000');
export const TAXI_MAP_PX_PER_KM = TAXI_MAP_IMAGE_PX / TAXI_MAP_SIZE_KM;

// ─── Комиссии такси ───────────────────────────────────────────
export const TAXI_COMMISSION_BANK  = 0.05; // 5% — оплата с банк. счёта
export const TAXI_COMMISSION_PHONE = 0.07; // 7% — оплата с телефона

// ─── Тайм-аут принятия заказа курьером ───────────────────────
// Если за N секунд заказ не принят — уведомить старший состав
export const ORDER_ACCEPT_TIMEOUT_SEC = 180; // 3 минуты

// ─── ID чатов доставки (peer_ids из env) ─────────────────────
export const CHATS = {
  rukovodstvo:          parseInt(process.env.VK_CHAT_RUKOVODSTVO_ID          || '0'),
  ss:                   parseInt(process.env.VK_CHAT_SS_ID                   || '0'),
  uchebny:              parseInt(process.env.VK_CHAT_UCHEBNY_ID              || '0'),
  doska:                parseInt(process.env.VK_CHAT_DOSKA_ID                || '0'),
  dispetcherskaya:      parseInt(process.env.VK_CHAT_DISPETCHERSKAYA_ID      || '0'),
  fludilka:             parseInt(process.env.VK_CHAT_FLUDILKA_ID             || '0'),
  zhurnal:              parseInt(process.env.VK_CHAT_ZHURNAL_ID              || '0'),
  sponsor:              parseInt(process.env.VK_CHAT_SPONSOR_ID              || '0'),
  // Такси — отдельные чаты
  taxiDispetcherskaya:  parseInt(process.env.VK_CHAT_TAXI_DISPETCHERSKAYA_ID || '0'),
  taxiSs:               parseInt(process.env.VK_CHAT_TAXI_SS_ID              || '0'),
  taxiFludilka:         parseInt(process.env.VK_CHAT_TAXI_FLUDILKA_ID        || '0'),
} as const;

export type ChatKey = keyof typeof CHATS;

export const ROLE_CHATS = {
  rs:      ['rukovodstvo', 'ss', 'doska', 'dispetcherskaya', 'fludilka', 'zhurnal'],
  ss:      ['ss', 'doska', 'dispetcherskaya', 'fludilka', 'zhurnal'],
  kurier:  ['doska', 'dispetcherskaya', 'fludilka', 'zhurnal'],
  stazher: ['uchebny', 'doska', 'dispetcherskaya'],
} as const;

export type Role = keyof typeof ROLE_CHATS | 'sponsor';

// ─── Финансовые коэффициенты ──────────────────────────────────
// Зарплата курьера = price - cost_price - salary_pct * price
// Доход = price * income_pct - (cost_price + salary) * expense_pct
export const SALARY_PCT_STANDARD = 0.15; // курьер без авто в цветах
export const SALARY_PCT_COLORED  = 0.10; // курьер с авто в цветах компании
export const INCOME_PCT_STANDARD = 0.15;
export const INCOME_PCT_COLORED  = 0.10;
export const EXPENSE_PCT         = 0.05;
