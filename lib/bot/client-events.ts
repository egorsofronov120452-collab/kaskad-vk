/**
 * client-events.ts
 * FSM-роутер для клиентских ЛС: сообщества 2 (доставка) и 3 (такси).
 *
 * States (delivery, group 2):
 *   main_menu → employment | faq | catalog | order
 *   catalog   → catalog_category → catalog_product
 *   order     → order_categories → order_category → order_products → order_product
 *             → cart → cart_delete_pick | checkout_nickname | checkout_place
 *             → checkout_confirm → awaiting_accept
 *
 * States (taxi, group 3):
 *   main_menu → employment | faq | taxi_order
 *   taxi_order → taxi_nickname → taxi_passengers → taxi_from_city → taxi_from_category
 *             → taxi_from_location → taxi_to_city → taxi_to_category → taxi_to_location
 *             → taxi_promo → taxi_payment → taxi_payment_screenshot → taxi_confirm
 *             → awaiting_accept
 */

import {
  CHATS,
  VK_GROUP2_ID,
  VK_GROUP3_ID,
  TAXI_COMMISSION_BANK,
  TAXI_COMMISSION_PHONE,
  TAXI_MAP_PX_PER_KM,
  TAXI_BASE_PRICE_PER_KM,
  ORDER_ACCEPT_TIMEOUT_SEC,
} from './config';
import {
  callVKGroup,
  sendMessageGroup,
  editMessageGroup,
  getUser,
} from './vk-api';
import {
  getClientSession,
  upsertClientSession,
  deleteClientSession,
  getCategories,
  getProductsByCategory,
  getProductById,
  getPromoCode,
  incrementPromoUsage,
  createDeliveryOrder,
  createTaxiOrder,
  updateDeliveryOrderStatus,
  getTaxiLocationCategories,
  getTaxiLocationsByCategory,
  getTaxiLocationById,
  getCurrentOnlineList,
  createContactRequest,
  updateContactRequestStatus,
  getPendingContactRequest,
} from './db';
import { createUserLink } from './utils';

// ─── Keyboard builders ────────────────────────────────────────

function kb(buttons: { label: string; payload: object; color?: string }[][], inline = true) {
  return JSON.stringify({
    inline,
    buttons: buttons.map(row =>
      row.map(b => ({
        action: { type: 'callback', label: b.label, payload: JSON.stringify(b.payload) },
        color: b.color ?? 'secondary',
      })),
    ),
  });
}

function kbText(buttons: { label: string; color?: string }[][], oneTime = true) {
  return JSON.stringify({
    one_time: oneTime,
    buttons: buttons.map(row =>
      row.map(b => ({
        action: { type: 'text', label: b.label },
        color: b.color ?? 'secondary',
      })),
    ),
  });
}

// ─── Cart helpers ─────────────────────────────────────────────

interface CartItem {
  productId: number;
  productName: string;
  price: number;
  costPrice: number;
  quantity: number;
}

function cartText(cart: CartItem[], discount = 0): string {
  if (!cart.length) return 'Корзина пуста.';
  const lines = cart.map(i => `${i.productName} | ${i.price}р. (x${i.quantity})`);
  const rawTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const total = discount > 0 ? Math.round(rawTotal * (1 - discount / 100)) : rawTotal;
  const discountLine = discount > 0 ? `\nСкидка: ${discount}%` : '';
  return `Корзина:\n____________\n${lines.join('\n')}\n______________${discountLine}\nИтог: ${total}р.`;
}

function cartTotal(cart: CartItem[], discount = 0): number {
  const raw = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  return discount > 0 ? Math.round(raw * (1 - discount / 100)) : raw;
}

// ─── Announcement to dispatch ─────────────────────────────────

async function notifyDispatchDelivery(orderId: number, nickname: string, place: string, cart: CartItem[], total: number) {
  const lines = cart.map(i => `${i.productName} | ${i.price}р. (x${i.quantity})`);
  const text = `Новый заказ #${orderId}\nНикнейм: ${nickname}\nМесто: ${place}\nЗаказ:\n${lines.join('\n')}\nИтого: ${total}р.`;
  const keyboard = kb([[
    { label: 'Принять заказ', payload: { action: 'take_delivery', orderId }, color: 'positive' },
  ]]);
  const msgId = await sendMessageGroup(CHATS.dispetcherskaya, text, 1, { keyboard });

  // Если за 3 мин никто не принял — пинг СС
  setTimeout(async () => {
    try {
      const order = await (await import('./db')).getDeliveryOrder(orderId) as any;
      if (order && order.status === 'pending') {
        const online = await getCurrentOnlineList();
        const couriers = online.filter((u: any) => u.activity_text === 'доставка');
        if (couriers.length) {
          const list = couriers.map((u: any) => `${u.nickname ?? u.vk_id} (${u.role})`).join('\n');
          await sendMessageGroup(CHATS.ss, `Заказ #${orderId} не принят 3 минуты!\nОнлайн курьеры:\n${list}`, 1);
        }
      }
    } catch { /* ignore */ }
  }, ORDER_ACCEPT_TIMEOUT_SEC * 1000);

  return msgId;
}

async function notifyDispatchTaxi(orderId: number, params: {
  nickname: string; passengers: string[]; from: string; to: string; payment: string; price?: number;
}) {
  const pax = params.passengers.length ? `\nПопутчики: ${params.passengers.join(', ')}` : '';
  const priceStr = params.price != null ? `\nСтоимость: ${params.price}р.` : '';
  const text = `Новый заказ такси #${orderId}\nНикнейм: ${params.nickname}${pax}\nОткуда: ${params.from}\nКуда: ${params.to}\nОплата: ${params.payment}${priceStr}`;
  const keyboard = kb([[
    { label: 'Принять заказ', payload: { action: 'take_taxi', orderId }, color: 'positive' },
  ]]);
  const msgId = await sendMessageGroup(CHATS.taxiDispetcherskaya, text, 1, { keyboard });

  setTimeout(async () => {
    try {
      const order = await (await import('./db')).getTaxiOrder(orderId) as any;
      if (order && order.status === 'pending') {
        const online = await getCurrentOnlineList();
        const drivers = online.filter((u: any) => u.activity_text === 'доставка');
        if (drivers.length) {
          const list = drivers.map((u: any) => `${u.nickname ?? u.vk_id} (${u.role})`).join('\n');
          await sendMessageGroup(CHATS.taxiSs, `Такси #${orderId} не принято 3 минуты!\nОнлайн водители:\n${list}`, 1);
        }
      }
    } catch { /* ignore */ }
  }, ORDER_ACCEPT_TIMEOUT_SEC * 1000);

  return msgId;
}

// ─── Main menu ────────────────────────────────────────────────

async function showMainMenuDelivery(peerId: number, existingMsgId?: number | null) {
  const text = 'Добро пожаловать! Выберите раздел:';
  const keyboard = kbText([
    [{ label: 'Каталог', color: 'primary' }, { label: 'Заказать', color: 'positive' }],
    [{ label: 'Трудоустройство', color: 'secondary' }, { label: 'Частые вопросы', color: 'secondary' }],
  ]);
  if (existingMsgId) {
    await editMessageGroup(peerId, existingMsgId, text, 2, { keyboard });
  } else {
    await sendMessageGroup(peerId, text, 2, { keyboard });
  }
}

async function showMainMenuTaxi(peerId: number, existingMsgId?: number | null) {
  const text = 'Добро пожаловать в сервис такси! Выберите раздел:';
  const keyboard = kbText([
    [{ label: 'Заказать такси', color: 'positive' }],
    [{ label: 'Трудоустройство', color: 'secondary' }, { label: 'Частые вопросы', color: 'secondary' }],
  ]);
  if (existingMsgId) {
    await editMessageGroup(peerId, existingMsgId, text, 3, { keyboard });
  } else {
    await sendMessageGroup(peerId, text, 3, { keyboard });
  }
}

// ─── Employment / FAQ ─────────────────────────────────────────

const EMPLOYMENT_TEXT = `Для трудоустройства свяжитесь с руководством по ссылке: vk.com/write-<ГРУППА>.

Требования:
• Возраст от 18 лет
• Наличие транспортного средства
• Ответственность и пунктуальность`;

const FAQ_TEXT = `Часто задаваемые вопросы:

Q: Как сделать заказ?
A: Нажмите «Заказать» в главном меню.

Q: Как долго ждать?
A: Обычно 15–30 минут.

Q: Можно ли отменить заказ?
A: Свяжитесь с поддержкой через это сообщество.`;

// ─── Delivery: order flow helpers ────────────────────────────

async function showOrderCategories(peerId: number, msgId: number | null, gid: 2 | 3, cart: CartItem[], discount: number) {
  const cats = await getCategories(null);
  if (!cats.length) {
    await sendMessageGroup(peerId, 'Категории пока не добавлены.', gid);
    return;
  }
  const rows = cats.map(c => [{ label: c.name, payload: { action: 'order_cat', catId: c.id }, color: 'secondary' as const }]);
  rows.push([{ label: 'Корзина', payload: { action: 'go_cart' }, color: 'positive' as const }]);
  rows.push([{ label: 'Назад', payload: { action: 'back_main' }, color: 'secondary' as const }]);
  const text = cart.length ? `${cartText(cart, discount)}\n\nВыберите категорию:` : 'Выберите категорию:';
  const keyboard = kb(rows);
  if (msgId) await editMessageGroup(peerId, msgId, text, gid, { keyboard });
  else {
    const id = await sendMessageGroup(peerId, text, gid, { keyboard });
    return id;
  }
}

async function showOrderProducts(peerId: number, msgId: number, catId: number, gid: 2 | 3, cart: CartItem[], discount: number, page = 0) {
  const products = await getProductsByCategory(catId);
  const PAGE = 6;
  const slice = products.slice(page * PAGE, (page + 1) * PAGE);
  const rows: { label: string; payload: object; color?: string }[][] = slice.map(p => [
    { label: `${p.name} | ${p.price}р.`, payload: { action: 'order_product', productId: p.id, catId, page } },
  ]);
  const nav: { label: string; payload: object; color?: string }[] = [];
  if (page > 0) nav.push({ label: '← Назад', payload: { action: 'order_products_page', catId, page: page - 1 } });
  if ((page + 1) * PAGE < products.length) nav.push({ label: 'Далее →', payload: { action: 'order_products_page', catId, page: page + 1 } });
  if (nav.length) rows.push(nav);
  rows.push([
    { label: 'Корзина', payload: { action: 'go_cart' }, color: 'positive' },
    { label: '← Категории', payload: { action: 'order_categories' }, color: 'secondary' },
  ]);
  const text = `${cart.length ? cartText(cart, discount) + '\n\n' : ''}Товары:`;
  await editMessageGroup(peerId, msgId, text, gid, { keyboard: kb(rows) });
}

async function showCart(peerId: number, msgId: number, gid: 2 | 3, cart: CartItem[], discount: number) {
  const text = cartText(cart, discount);
  const rows: { label: string; payload: object; color?: string }[][] = [
    [
      { label: 'Добавить ещё', payload: { action: 'order_categories' }, color: 'secondary' },
      { label: 'Удалить товар', payload: { action: 'cart_delete' }, color: 'negative' },
    ],
    [
      { label: 'Очистить корзину', payload: { action: 'cart_clear' }, color: 'negative' },
      { label: 'Оформить заказ', payload: { action: 'checkout' }, color: 'positive' },
    ],
    [{ label: 'Главное меню', payload: { action: 'back_main' }, color: 'secondary' }],
  ];
  await editMessageGroup(peerId, msgId, text, gid, { keyboard: kb(rows) });
}

// ─── Taxi: price calculation ──────────────────────────────────

function calcTaxiPrice(fromX: number, fromY: number, toX: number, toY: number, promoDiscount = 0): number {
  const dx = (toX - fromX) / TAXI_MAP_PX_PER_KM;
  const dy = (toY - fromY) / TAXI_MAP_PX_PER_KM;
  const km = Math.sqrt(dx * dx + dy * dy);
  const base = Math.round(km * TAXI_BASE_PRICE_PER_KM);
  return promoDiscount > 0 ? Math.round(base * (1 - promoDiscount / 100)) : base;
}

// ─── Callback handler (inline buttons) ───────────────────────

async function handleClientCallback(event: any, gid: 2 | 3) {
  const userId: number = event.object.user_id;
  const peerId: number = event.object.peer_id;
  const cmid: number  = event.object.conversation_message_id;
  const eventId: string = event.object.event_id;

  const payloadRaw = event.object.payload;
  const payload = typeof payloadRaw === 'string' ? JSON.parse(payloadRaw) : payloadRaw;
  const action: string = payload.action;

  // Ack callback immediately
  try {
    await callVKGroup('messages.sendMessageEventAnswer', {
      event_id: eventId,
      user_id: userId,
      peer_id: peerId,
    }, gid);
  } catch { /* ignore ack errors */ }

  const session = await getClientSession(userId, gid) ?? { vkId: userId, groupId: gid, state: 'main_menu', data: {}, messageId: null, updatedAt: 0 };
  const data = { ...session.data };

  // ─── Delivery order callbacks ─────────────────────────────

  if (gid === 2) {
    if (action === 'back_main') {
      await deleteClientSession(userId, gid);
      await showMainMenuDelivery(peerId);
      return;
    }
    if (action === 'go_catalog') {
      const cats = await getCategories(null);
      if (!cats.length) { await sendMessageGroup(peerId, 'Каталог пока пуст.', gid); return; }
      const rows = cats.map(c => [{ label: c.name, payload: { action: 'catalog_cat', catId: c.id }, color: 'secondary' as const }]);
      rows.push([{ label: 'Назад', payload: { action: 'back_main' }, color: 'secondary' as const }]);
      await editMessageGroup(peerId, cmid, 'Выберите категорию каталога:', gid, { keyboard: kb(rows) });
      return;
    }
    if (action === 'catalog_cat') {
      const products = await getProductsByCategory(payload.catId);
      if (!products.length) { await editMessageGroup(peerId, cmid, 'В этой категории пока нет товаров.', gid, { keyboard: kb([[{ label: 'Назад', payload: { action: 'go_catalog' } }]]) }); return; }
      const cat = await (await import('./db')).getCategoryById(payload.catId) as any;
      const rows = products.map(p => [{ label: `${p.name} — ${p.price}р.`, payload: { action: 'catalog_product', productId: p.id, catId: payload.catId } }]);
      rows.push([{ label: 'Назад', payload: { action: 'go_catalog' }, color: 'secondary' }]);
      await editMessageGroup(peerId, cmid, `Категория: ${cat?.name ?? ''}\nВыберите товар:`, gid, { keyboard: kb(rows) });
      return;
    }
    if (action === 'catalog_product') {
      const product = await getProductById(payload.productId);
      if (!product) return;
      const photo = product.photoId ? { attachment: product.photoId } : {};
      const rows: { label: string; payload: object; color?: string }[][] = [[{ label: 'Назад', payload: { action: 'catalog_cat', catId: payload.catId }, color: 'secondary' }]];
      await editMessageGroup(peerId, cmid, `${product.name}\nЦена: ${product.price}р.`, gid, { keyboard: kb(rows), ...photo });
      return;
    }

    // Order flow
    if (action === 'order_categories') {
      const cart: CartItem[] = data.cart ?? [];
      const discount: number = data.promoDiscount ?? 0;
      await showOrderCategories(peerId, cmid, gid, cart, discount);
      await upsertClientSession(userId, gid, 'order_categories', data, cmid);
      return;
    }
    if (action === 'order_cat') {
      const cart: CartItem[] = data.cart ?? [];
      const discount: number = data.promoDiscount ?? 0;
      data.currentCatId = payload.catId;
      await upsertClientSession(userId, gid, 'order_products', data, cmid);
      await showOrderProducts(peerId, cmid, payload.catId, gid, cart, discount, 0);
      return;
    }
    if (action === 'order_products_page') {
      const cart: CartItem[] = data.cart ?? [];
      const discount: number = data.promoDiscount ?? 0;
      await showOrderProducts(peerId, cmid, payload.catId, gid, cart, discount, payload.page ?? 0);
      return;
    }
    if (action === 'order_product') {
      const product = await getProductById(payload.productId);
      if (!product) return;
      const cart: CartItem[] = data.cart ?? [];
      const existing = cart.find(i => i.productId === product.id);
      if (existing) { existing.quantity += 1; } else { cart.push({ productId: product.id, productName: product.name, price: product.price, costPrice: product.costPrice, quantity: 1 }); }
      data.cart = cart;
      const discount: number = data.promoDiscount ?? 0;
      await upsertClientSession(userId, gid, 'order_products', data, cmid);
      await showOrderProducts(peerId, cmid, payload.catId, gid, cart, discount, payload.page ?? 0);
      return;
    }
    if (action === 'go_cart') {
      const cart: CartItem[] = data.cart ?? [];
      if (!cart.length) { await editMessageGroup(peerId, cmid, 'Корзина пуста. Добавьте товары.', gid, { keyboard: kb([[{ label: 'Выбрать товары', payload: { action: 'order_categories' } }]]) }); return; }
      await upsertClientSession(userId, gid, 'cart', data, cmid);
      await showCart(peerId, cmid, gid, cart, data.promoDiscount ?? 0);
      return;
    }
    if (action === 'cart_clear') {
      data.cart = [];
      await upsertClientSession(userId, gid, 'order_categories', data, cmid);
      await showOrderCategories(peerId, cmid, gid, [], 0);
      return;
    }
    if (action === 'cart_delete') {
      const cart: CartItem[] = data.cart ?? [];
      if (!cart.length) return;
      const rows = cart.map((i, idx) => [{ label: `${i.productName} (x${i.quantity})`, payload: { action: 'cart_delete_item', idx }, color: 'negative' as const }]);
      rows.push([{ label: 'Отмена', payload: { action: 'go_cart' }, color: 'secondary' }]);
      await editMessageGroup(peerId, cmid, 'Какой товар удалить?', gid, { keyboard: kb(rows) });
      return;
    }
    if (action === 'cart_delete_item') {
      const cart: CartItem[] = data.cart ?? [];
      const idx: number = payload.idx;
      if (cart[idx]) {
        if (cart[idx].quantity > 1) cart[idx].quantity -= 1;
        else cart.splice(idx, 1);
      }
      data.cart = cart;
      await upsertClientSession(userId, gid, 'cart', data, cmid);
      await showCart(peerId, cmid, gid, cart, data.promoDiscount ?? 0);
      return;
    }
    if (action === 'checkout') {
      await upsertClientSession(userId, gid, 'checkout_nickname', data, cmid);
      await editMessageGroup(peerId, cmid, `${cartText(data.cart ?? [], data.promoDiscount ?? 0)}\n\nВведите ваш никнейм:`, gid, { keyboard: kb([[{ label: 'Отмена', payload: { action: 'go_cart' }, color: 'negative' }]]) });
      return;
    }

    // Delivery order confirmation
    if (action === 'confirm_order') {
      const cart: CartItem[] = data.cart ?? [];
      const discount: number = data.promoDiscount ?? 0;
      const total = cartTotal(cart, discount);
      const orderId = await createDeliveryOrder(userId, data.nickname, data.place, cart, total, data.promoCodeId ?? null, cmid);
      const dispatchMsgId = await notifyDispatchDelivery(orderId, data.nickname, data.place, cart, total);
      await updateDeliveryOrderStatus(orderId, 'pending', { dispatchCmid: dispatchMsgId ?? undefined });
      await upsertClientSession(userId, gid, 'awaiting_accept', { orderId }, cmid);
      await editMessageGroup(peerId, cmid, `${cartText(cart, discount)}\n\nЗаказ #${orderId} отправлен! Ожидайте принятия заказа курьером.`, gid, {
        keyboard: kb([[{ label: 'Статус заказа', payload: { action: 'order_status', orderId } }]]),
      });
      return;
    }
    if (action === 'cancel_order_confirm') {
      data.place = null;
      await upsertClientSession(userId, gid, 'checkout_place', data, cmid);
      await editMessageGroup(peerId, cmid, `${cartText(data.cart ?? [], data.promoDiscount ?? 0)}\n\nВведите место доставки:`, gid, {
        keyboard: kb([[{ label: 'Отмена', payload: { action: 'go_cart' }, color: 'negative' }]]),
      });
      return;
    }
    if (action === 'order_status') {
      const orderId: number = payload.orderId ?? data.orderId;
      const order = await (await import('./db')).getDeliveryOrder(orderId) as any;
      if (!order) return;
      const statusMap: Record<string, string> = {
        pending: 'Ожидает курьера',
        accepted: 'Принят курьером',
        preparing: 'Заказ готовится',
        delivering: 'Курьер едет к вам',
        delivered: 'Доставлен',
        cancelled: 'Отменён',
      };
      await sendMessageGroup(peerId, `Заказ #${orderId}\nСтатус: ${statusMap[order.status] ?? order.status}`, gid);
      return;
    }

    // Staff: take_delivery callback (from group 1 dispatch)
    if (action === 'take_delivery') {
      // This is handled in events.ts for group 1 callbacks, kept here as a fallback
      return;
    }
  }

  // ─── Taxi callbacks ───────────────────────────────────────

  if (gid === 3) {
    if (action === 'back_main') {
      await deleteClientSession(userId, gid);
      await showMainMenuTaxi(peerId);
      return;
    }
    if (action === 'taxi_start') {
      data.passengers = [];
      await upsertClientSession(userId, gid, 'taxi_nickname', data, cmid);
      await editMessageGroup(peerId, cmid, 'Введите ваш никнейм:', gid, {
        keyboard: kb([[{ label: 'Отмена', payload: { action: 'back_main' }, color: 'negative' }]]),
      });
      return;
    }
    if (action === 'taxi_no_passengers') {
      data.passengers = [];
      await upsertClientSession(userId, gid, 'taxi_from_city', data, cmid);
      await showTaxiLocationPicker(peerId, cmid, gid, 'from', data);
      return;
    }
    if (action === 'taxi_location_from') {
      data.fromLocationId = payload.locationId;
      data.fromLocationName = payload.locationName;
      await upsertClientSession(userId, gid, 'taxi_to_city', data, cmid);
      await showTaxiLocationPicker(peerId, cmid, gid, 'to', data);
      return;
    }
    if (action === 'taxi_location_to') {
      data.toLocationId = payload.locationId;
      data.toLocationName = payload.locationName;
      await upsertClientSession(userId, gid, 'taxi_promo', data, cmid);
      const fromLoc = await getTaxiLocationById(data.fromLocationId);
      const toLoc   = await getTaxiLocationById(data.toLocationId);
      const basePrice = (fromLoc && toLoc) ? calcTaxiPrice(fromLoc.x_px, fromLoc.y_px, toLoc.x_px, toLoc.y_px, 0) : null;
      data.basePrice = basePrice;
      await editMessageGroup(peerId, cmid,
        `Откуда: ${data.fromLocationName}\nКуда: ${data.toLocationName}${basePrice ? `\nПримерная стоимость: ${basePrice}р.` : ''}\n\nЕсть промокод? Введите его или пропустите:`,
        gid, {
          keyboard: kb([[{ label: 'Пропустить', payload: { action: 'taxi_skip_promo' }, color: 'secondary' }]]),
        });
      return;
    }
    if (action === 'taxi_skip_promo') {
      await upsertClientSession(userId, gid, 'taxi_payment', data, cmid);
      await showTaxiPayment(peerId, cmid, gid, data);
      return;
    }
    if (action === 'taxi_pay_cash') {
      data.paymentType = 'cash';
      const discount: number = data.promoDiscount ?? 0;
      const fromLoc = await getTaxiLocationById(data.fromLocationId);
      const toLoc   = await getTaxiLocationById(data.toLocationId);
      if (fromLoc && toLoc) {
        data.basePrice = calcTaxiPrice(fromLoc.x_px, fromLoc.y_px, toLoc.x_px, toLoc.y_px, discount);
      }
      data.commission = 0;
      data.finalPrice = data.basePrice;
      await upsertClientSession(userId, gid, 'taxi_confirm', data, cmid);
      await showTaxiConfirm(peerId, cmid, gid, data);
      return;
    }
    if (action === 'taxi_pay_bank') {
      data.paymentType = 'bank';
      data.commission = TAXI_COMMISSION_BANK;
      const discount: number = data.promoDiscount ?? 0;
      const fromLoc = await getTaxiLocationById(data.fromLocationId);
      const toLoc   = await getTaxiLocationById(data.toLocationId);
      if (fromLoc && toLoc) {
        const base = calcTaxiPrice(fromLoc.x_px, fromLoc.y_px, toLoc.x_px, toLoc.y_px, discount);
        data.basePrice = base;
        data.finalPrice = Math.round(base * (1 + TAXI_COMMISSION_BANK));
      }
      await upsertClientSession(userId, gid, 'taxi_payment_screenshot', data, cmid);
      await editMessageGroup(peerId, cmid,
        `Сумма к оплате: ${data.finalPrice}р.\nКомиссия: ${Math.round(TAXI_COMMISSION_BANK * 100)}%\n\nПереведите на счёт 852006, укажите /timestamp или время над HUD.\nПришлите скриншот оплаты:`,
        gid, { keyboard: kb([[{ label: 'Отмена', payload: { action: 'back_main' }, color: 'negative' }]]) });
      return;
    }
    if (action === 'taxi_confirm_order') {
      const orderId = await createTaxiOrder({
        clientVkId: userId,
        nickname: data.nickname,
        passengers: data.passengers ?? [],
        fromLocationId: data.fromLocationId ?? null,
        fromCustom: data.fromCustom ?? null,
        toLocationId: data.toLocationId ?? null,
        toCustom: data.toCustom ?? null,
        promoCodeId: data.promoCodeId ?? null,
        paymentType: data.paymentType,
        basePrice: data.basePrice ?? null,
        commission: data.commission ?? null,
        finalPrice: data.finalPrice ?? null,
        clientMsgId: cmid,
      });
      const fromName = data.fromLocationName ?? data.fromCustom ?? '?';
      const toName   = data.toLocationName   ?? data.toCustom   ?? '?';
      const payStr   = data.paymentType === 'cash' ? 'Наличные' : 'Банк. счёт';
      const dispatchMsgId = await notifyDispatchTaxi(orderId, { nickname: data.nickname, passengers: data.passengers ?? [], from: fromName, to: toName, payment: payStr, price: data.finalPrice });
      await upsertClientSession(userId, gid, 'awaiting_accept', { orderId }, cmid);
      await editMessageGroup(peerId, cmid,
        `Заказ такси #${orderId} отправлен!\nОжидайте принятия водителем.`,
        gid, { keyboard: kb([[{ label: 'Статус', payload: { action: 'taxi_status', orderId } }]]) });
      return;
    }
    if (action === 'taxi_status') {
      const orderId: number = payload.orderId ?? data.orderId;
      const order = await (await import('./db')).getTaxiOrder(orderId) as any;
      if (!order) return;
      const statusMap: Record<string, string> = {
        pending: 'Ожидает водителя',
        accepted: 'Принят',
        waiting: 'Платное ожидание',
        in_progress: 'В пути',
        delivered: 'Завершён',
        cancelled: 'Отменён',
      };
      await sendMessageGroup(peerId, `Такси #${orderId}\nСтатус: ${statusMap[order.status] ?? order.status}`, gid);
      return;
    }
    if (action === 'taxi_contact_courier') {
      const orderId: number = data.orderId;
      const order = await (await import('./db')).getTaxiOrder(orderId) as any;
      if (!order || !order.driver_vk_id) { await sendMessageGroup(peerId, 'Водитель ещё не назначен.', gid); return; }
      await upsertClientSession(userId, gid, 'awaiting_accept', data, cmid);
      const reqId = await createContactRequest(orderId, 'taxi', userId, order.driver_vk_id);
      // Notify driver
      await sendMessageGroup(order.driver_vk_id, `Клиент по заказу #${orderId} запрашивает ваши контакты. Разрешить?\nЗапрос #${reqId}`, 1, {
        keyboard: kb([[
          { label: 'Разрешить', payload: { action: 'contact_approve', reqId }, color: 'positive' },
          { label: 'Отклонить', payload: { action: 'contact_reject', reqId }, color: 'negative' },
        ]]),
      });
      await editMessageGroup(peerId, cmid, 'Запрос отправлен водителю. Ожидайте ответа.', gid);
      return;
    }
  }

  // ─── Staff callbacks for contact requests (handled in group 1) ─

  if (action === 'contact_approve') {
    const req = await getPendingContactRequest(payload.reqId);
    if (!req) return;
    await updateContactRequestStatus(payload.reqId, 'approved');
    const driver = await getUser(req.target_id);
    const driverLink = driver ? `vk.com/id${driver.id}` : `ID${req.target_id}`;
    await sendMessageGroup(req.requester_id, `Водитель разрешил контакт: ${driverLink}`, req.order_type === 'taxi' ? 3 : 2);
    await sendMessageGroup(userId, 'Вы предоставили контакт клиенту.', 1);
    return;
  }
  if (action === 'contact_reject') {
    const req = await getPendingContactRequest(payload.reqId);
    if (!req) return;
    await updateContactRequestStatus(payload.reqId, 'rejected');
    await sendMessageGroup(req.requester_id, 'Водитель отклонил запрос на контакт.', req.order_type === 'taxi' ? 3 : 2);
    await sendMessageGroup(userId, 'Вы отклонили запрос клиента.', 1);
    return;
  }
}

// ─── Taxi location picker helper ──────────────────────────────

async function showTaxiLocationPicker(peerId: number, cmid: number, gid: 2 | 3, direction: 'from' | 'to', data: any) {
  const cats = await getTaxiLocationCategories();
  if (!cats.length) {
    await editMessageGroup(peerId, cmid, `Введите ${direction === 'from' ? 'откуда' : 'куда'} (вручную):`, gid, {
      keyboard: kb([[{ label: 'Отмена', payload: { action: 'back_main' }, color: 'negative' }]]),
    });
    return;
  }
  const rows = cats.map((c: any) => [{ label: c.name, payload: { action: `taxi_cat_${direction}`, catId: c.id } }]);
  rows.push([{ label: 'Отмена', payload: { action: 'back_main' }, color: 'negative' }]);
  await editMessageGroup(peerId, cmid, `Выберите категорию (${direction === 'from' ? 'откуда' : 'куда'}):`, gid, { keyboard: kb(rows) });
}

async function showTaxiPayment(peerId: number, cmid: number, gid: 2 | 3, data: any) {
  const discount: number = data.promoDiscount ?? 0;
  const fromLoc = data.fromLocationId ? await getTaxiLocationById(data.fromLocationId) : null;
  const toLoc   = data.toLocationId   ? await getTaxiLocationById(data.toLocationId)   : null;
  let priceInfo = '';
  if (fromLoc && toLoc) {
    const base = calcTaxiPrice(fromLoc.x_px, fromLoc.y_px, toLoc.x_px, toLoc.y_px, discount);
    const withBank  = Math.round(base * (1 + TAXI_COMMISSION_BANK));
    const withPhone = Math.round(base * (1 + TAXI_COMMISSION_PHONE));
    priceInfo = `\n\nСтоимость (наличные): ${base}р.\nС банк. счёта (комиссия ${Math.round(TAXI_COMMISSION_BANK * 100)}%): ${withBank}р.`;
  }
  await editMessageGroup(peerId, cmid, `Выберите способ оплаты:${priceInfo}`, gid, {
    keyboard: kb([[
      { label: 'Наличные', payload: { action: 'taxi_pay_cash' }, color: 'secondary' },
      { label: 'Банк. счёт', payload: { action: 'taxi_pay_bank' }, color: 'primary' },
    ],
    [{ label: 'Отмена', payload: { action: 'back_main' }, color: 'negative' }]]),
  });
}

async function showTaxiConfirm(peerId: number, cmid: number, gid: 2 | 3, data: any) {
  const pax = data.passengers?.length ? `\nПопутчики: ${data.passengers.join(', ')}` : '';
  const price = data.finalPrice != null ? `\nСтоимость: ${data.finalPrice}р.` : '';
  const pay = data.paymentType === 'cash' ? 'Наличные' : 'Банк. счёт';
  const text = `Проверьте данные:\nНикнейм: ${data.nickname}${pax}\nОткуда: ${data.fromLocationName ?? data.fromCustom ?? '?'}\nКуда: ${data.toLocationName ?? data.toCustom ?? '?'}\nОплата: ${pay}${price}`;
  await editMessageGroup(peerId, cmid, text, gid, {
    keyboard: kb([[
      { label: 'Подтвердить', payload: { action: 'taxi_confirm_order' }, color: 'positive' },
      { label: 'Отмена', payload: { action: 'back_main' }, color: 'negative' },
    ]]),
  });
}

// ─── Message handler ──────────────────────────────────────────

async function handleClientMessage(message: any, gid: 2 | 3) {
  const userId: number = message.from_id;
  const peerId: number = message.peer_id;
  const text: string   = (message.text ?? '').trim();

  // Only accept DMs (peer_id == from_id for personal messages)
  if (peerId !== userId) return;

  const session = await getClientSession(userId, gid);
  const state   = session?.state ?? 'main_menu';
  const data    = { ...(session?.data ?? {}) };
  const msgId   = session?.messageId ?? null;

  // ─── Text-based keyboard actions ─────────────────────────

  if (state === 'main_menu' || !session) {
    if (text === 'Каталог') {
      const cats = await getCategories(null);
      if (!cats.length) { await sendMessageGroup(peerId, 'Каталог пока пуст.', gid); return; }
      const rows = cats.map(c => [{ label: c.name, payload: { action: 'catalog_cat', catId: c.id }, color: 'secondary' as const }]);
      rows.push([{ label: 'Назад', payload: { action: 'back_main' }, color: 'secondary' as const }]);
      const newMsgId = await sendMessageGroup(peerId, 'Выберите категорию каталога:', gid, { keyboard: kb(rows) });
      await upsertClientSession(userId, gid, 'catalog', data, newMsgId);
      return;
    }
    if (text === 'Заказать') {
      const newMsgId = await sendMessageGroup(peerId, 'Выберите категорию:', gid, { keyboard: kb([[{ label: 'Загрузка...', payload: { action: 'noop' } }]]) });
      data.cart = [];
      await upsertClientSession(userId, gid, 'order_categories', data, newMsgId);
      if (newMsgId) await showOrderCategories(peerId, newMsgId, gid, [], 0);
      return;
    }
    if (text === 'Трудоустройство') {
      await sendMessageGroup(peerId, EMPLOYMENT_TEXT, gid, {
        keyboard: kbText([[{ label: 'Главное меню' }]]),
      });
      return;
    }
    if (text === 'Частые вопросы') {
      await sendMessageGroup(peerId, FAQ_TEXT, gid, {
        keyboard: kbText([[{ label: 'Главное меню' }]]),
      });
      return;
    }
    if (text === 'Заказать такси' && gid === 3) {
      const newMsgId = await sendMessageGroup(peerId, 'Введите ваш никнейм:', gid, {
        keyboard: kb([[{ label: 'Отмена', payload: { action: 'back_main' }, color: 'negative' }]]),
      });
      data.passengers = [];
      await upsertClientSession(userId, gid, 'taxi_nickname', data, newMsgId);
      return;
    }
    if (text === 'Главное меню') {
      await deleteClientSession(userId, gid);
      if (gid === 2) await showMainMenuDelivery(peerId);
      else await showMainMenuTaxi(peerId);
      return;
    }
    // No session — show main menu
    if (!session) {
      if (gid === 2) await showMainMenuDelivery(peerId);
      else await showMainMenuTaxi(peerId);
      return;
    }
    return;
  }

  // ─── FSM: text input states ───────────────────────────────

  if (state === 'checkout_nickname') {
    data.nickname = text;
    await upsertClientSession(userId, gid, 'checkout_place', data, msgId);
    if (msgId) await editMessageGroup(peerId, msgId, `${cartText(data.cart ?? [], data.promoDiscount ?? 0)}\n\nНикнейм: ${text}\n\nВведите место доставки:`, gid, {
      keyboard: kb([[{ label: 'Отмена', payload: { action: 'go_cart' }, color: 'negative' }]]),
    });
    return;
  }

  if (state === 'checkout_place') {
    data.place = text;
    await upsertClientSession(userId, gid, 'checkout_confirm', data, msgId);
    const cart: CartItem[] = data.cart ?? [];
    const discount: number = data.promoDiscount ?? 0;
    const total = cartTotal(cart, discount);
    if (msgId) await editMessageGroup(peerId, msgId,
      `${cartText(cart, discount)}\n\nНикнейм: ${data.nickname}\nМесто: ${text}\nИтог: ${total}р.\n\nВсё верно?`, gid, {
        keyboard: kb([[
          { label: 'Подтвердить', payload: { action: 'confirm_order' }, color: 'positive' },
          { label: 'Изменить', payload: { action: 'cancel_order_confirm' }, color: 'negative' },
        ]]),
      });
    return;
  }

  if (state === 'taxi_nickname') {
    data.nickname = text;
    await upsertClientSession(userId, gid, 'taxi_passengers', data, msgId);
    if (msgId) await editMessageGroup(peerId, msgId, `Никнейм: ${text}\n\nДобавить попутчиков? (введите никнейм или пропустите):`, gid, {
      keyboard: kb([[
        { label: 'Без попутчиков', payload: { action: 'taxi_no_passengers' }, color: 'secondary' },
        { label: 'Отмена', payload: { action: 'back_main' }, color: 'negative' },
      ]]),
    });
    return;
  }

  if (state === 'taxi_passengers') {
    const passengers: string[] = data.passengers ?? [];
    if (passengers.length < 2) passengers.push(text);
    data.passengers = passengers;
    await upsertClientSession(userId, gid, passengers.length < 2 ? 'taxi_passengers' : 'taxi_from_city', data, msgId);
    if (passengers.length < 2) {
      if (msgId) await editMessageGroup(peerId, msgId, `Добавлен: ${text}\n\nЕщё один попутчик? (или пропустите):`, gid, {
        keyboard: kb([[
          { label: 'Продолжить', payload: { action: 'taxi_no_passengers' }, color: 'secondary' },
          { label: 'Отмена', payload: { action: 'back_main' }, color: 'negative' },
        ]]),
      });
    } else {
      if (msgId) await showTaxiLocationPicker(peerId, msgId, gid, 'from', data);
    }
    return;
  }

  if (state === 'taxi_promo') {
    const promo = await getPromoCode(text);
    if (!promo) {
      if (msgId) await editMessageGroup(peerId, msgId, 'Промокод не найден или недействителен. Попробуйте ещё раз или пропустите:', gid, {
        keyboard: kb([[{ label: 'Пропустить', payload: { action: 'taxi_skip_promo' }, color: 'secondary' }]]),
      });
      return;
    }
    data.promoCodeId    = promo.id;
    data.promoDiscount  = promo.discount_pct;
    await incrementPromoUsage(promo.id);
    await upsertClientSession(userId, gid, 'taxi_payment', data, msgId);
    if (msgId) await showTaxiPayment(peerId, msgId, gid, data);
    return;
  }

  if (state === 'taxi_payment_screenshot') {
    const photos = message.attachments?.filter((a: any) => a.type === 'photo') ?? [];
    if (!photos.length) {
      await sendMessageGroup(peerId, 'Пришлите скриншот оплаты (фото).', gid);
      return;
    }
    data.paymentScreenshot = `photo${photos[0].photo.owner_id}_${photos[0].photo.id}`;
    await upsertClientSession(userId, gid, 'taxi_confirm', data, msgId);
    if (msgId) await showTaxiConfirm(peerId, msgId, gid, data);
    return;
  }

  // Promo code state for delivery
  if (state === 'cart_promo') {
    const promo = await getPromoCode(text);
    if (!promo) {
      await sendMessageGroup(peerId, 'Промокод не найден.', gid);
      return;
    }
    data.promoCodeId   = promo.id;
    data.promoDiscount = promo.discount_pct;
    await incrementPromoUsage(promo.id);
    await upsertClientSession(userId, gid, 'cart', data, msgId);
    if (msgId) await showCart(peerId, msgId, gid, data.cart ?? [], promo.discount_pct);
    return;
  }
}

// ─── Public entry point ───────────────────────────────────────

export async function handleClientEvent(event: any, gid: 2 | 3) {
  try {
    if (event.type === 'message_new' && event.object?.message) {
      await handleClientMessage(event.object.message, gid);
    }
    if (event.type === 'message_event') {
      await handleClientCallback(event, gid);
    }
  } catch (err: any) {
    console.error(`[Bot${gid}] Ошибка:`, err.message);
  }
}
