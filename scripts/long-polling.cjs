/**
 * VK Long Polling Bot - Standalone версия
 * 
 * Полнофункциональный бот для управления чатами с системой ролей
 * Реализует все команды из VK_BOT_README.md
 * 
 * Команды:
 * !пост - публикация в группу (РС и СС)
 * !приветствие [чат] - установка приветствия (только РС)
 * !закреп [чат] - закрепление сообщения (только РС)
 * !кик - удаление пользователя (РС и СС)
 * !чат - узнать ID текущего чата (все)
 * !увед - массовое уведомление (РС и СС)
 * !диагностика - проверка токенов и прав (все)
 * 
 * Запуск: node scripts/long-polling.cjs
 * PM2: pm2 start scripts/long-polling.cjs --name vk-bot
 */

const path = require('path');
const fs = require('fs');

// Загружаем .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
  console.log('[VK Bot] .env файл загружен');
} else {
  console.error('[VK Bot] .env файл не найден');
}

// Конфигурация
const VK_GROUP1_TOKEN = process.env.VK_GROUP1_TOKEN;
const VK_GROUP2_TOKEN = process.env.VK_GROUP2_TOKEN;
const VK_USER_TOKEN = process.env.VK_USER_TOKEN; // УСТАРЕЛО: больше не используется, управление через GROUP TOKEN
const VK_GROUP1_ID = process.env.VK_GROUP1_ID;
const VK_GROUP2_ID = process.env.VK_GROUP2_ID;
const VK_API_VERSION = '5.131';

// ID чатов (peer_ids из .env)
const CHATS = {
  rukovodstvo: parseInt(process.env.VK_CHAT_RUKOVODSTVO_ID || '0'),
  ss: parseInt(process.env.VK_CHAT_SS_ID || '0'),
  uchebny: parseInt(process.env.VK_CHAT_UCHEBNY_ID || '0'),
  doska: parseInt(process.env.VK_CHAT_DOSKA_ID || '0'),
  dispetcherskaya: parseInt(process.env.VK_CHAT_DISPETCHERSKAYA_ID || '0'),
  fludilka: parseInt(process.env.VK_CHAT_FLUDILKA_ID || '0'),
  zhurnal: parseInt(process.env.VK_CHAT_ZHURNAL_ID || '0'),
  sponsor: parseInt(process.env.VK_CHAT_SPONSOR_ID || '0'),
};

// Преобразуем peer_id в chat_id для всех чатов
// VK API для addChatUser/removeChatUser требует chat_id (маленькие числа)
// а в .env хранятся peer_id (2000000000+)
function getChatId(chatPeerId) {
  if (chatPeerId > 2000000000) {
    return chatPeerId - 2000000000;
  }
  return chatPeerId; // Уже chat_id
}

// Маппинг ролей на чаты
const ROLE_CHATS = {
  rs: ['rukovodstvo', 'ss', 'doska', 'dispetcherskaya', 'fludilka', 'zhurnal'],
  ss: ['ss', 'doska', 'dispetcherskaya', 'fludilka', 'zhurnal'],
  kurier: ['doska', 'dispetcherskaya', 'fludilka', 'zhurnal'],
  stazher: ['uchebny', 'doska', 'dispetcherskaya'],
};

// Хранилище в памяти
const storage = {
  greetings: new Map(), // peer_id -> greeting_text
  localBlacklist: new Map(), // userId -> { endDate: timestamp, reason: string, bannedAt: timestamp, bannedBy: userId }
  mutes: new Map(), // `${peerId}_${userId}` -> { endDate: timestamp, reason: string, mutedAt: timestamp, mutedBy: userId }
};

// Путь к файлам
const BLACKLIST_FILE = path.join(__dirname, 'blacklist.json');
const MUTES_FILE = path.join(__dirname, 'mutes.json');

// Загрузка локального ЧС из файла
function loadLocalBlacklist() {
  try {
    if (fs.existsSync(BLACKLIST_FILE)) {
      const data = fs.readFileSync(BLACKLIST_FILE, 'utf8');
      const parsed = JSON.parse(data);

      // Очищаем устаревшие баны
      const now = Date.now();
      for (const [userId, banInfo] of Object.entries(parsed)) {
        if (banInfo.endDate === 0 || banInfo.endDate > now) {
          storage.localBlacklist.set(parseInt(userId), banInfo);
        }
      }

      console.log('[VK Bot] Локальный ЧС загружен:', storage.localBlacklist.size, 'пользователей');
    } else {
      console.log('[VK Bot] Файл ЧС не найден, создан новый');
      saveLocalBlacklist();
    }
  } catch (error) {
    console.error('[VK Bot] Ошибка загрузки ЧС:', error.message);
  }
}

// Сохранение локального ЧС в файл
function saveLocalBlacklist() {
  try {
    const data = {};
    for (const [userId, banInfo] of storage.localBlacklist.entries()) {
      data[userId] = banInfo;
    }
    fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('[VK Bot] Локальный ЧС сохранен');
  } catch (error) {
    console.error('[VK Bot] Ошибка сохранения ЧС:', error.message);
  }
}

// Добавление пользователя в локальный ЧС
function addToLocalBlacklist(userId, days, reason = 'Нарушение правил', bannedBy = null) {
  const now = Date.now();
  const endDate = days === 0 || days === 999 ? 0 : now + days * 24 * 60 * 60 * 1000;

  storage.localBlacklist.set(userId, {
    endDate,
    reason,
    bannedAt: now,
    bannedBy, // ID пользователя, который забанил
  });

  saveLocalBlacklist();
  console.log('[VK Bot] Пользователь', userId, 'добавлен в локальный ЧС до', endDate === 0 ? 'ПЕРМАНЕНТНО' : formatBanEndDate(endDate));
}

// Удаление пользователя из локального ЧС
function removeFromLocalBlacklist(userId) {
  const deleted = storage.localBlacklist.delete(userId);
  if (deleted) {
    saveLocalBlacklist();
    console.log('[VK Bot] Пользователь', userId, 'удален из локального ЧС');
  }
  return deleted;
}

// Проверка, находится ли пользователь в локальном ЧС
function isUserInLocalBlacklist(userId) {
  const banInfo = storage.localBlacklist.get(userId);
  if (!banInfo) return null;

  const now = Date.now();

  // Перманентный бан
  if (banInfo.endDate === 0) {
    return banInfo;
  }

  // Временный бан - проверяем не истек ли
  if (banInfo.endDate > now) {
    return banInfo;
  }

  // Бан истек - удаляем
  removeFromLocalBlacklist(userId);
  return null;
}

// Форматирование даты разбана (МСК)
function formatBanEndDate(endDate) {
  if (endDate === 0) {
    return 'ПЕРМАНЕНТНО';
  }
  const date = new Date(endDate);
  // Конвертируем в МСК (UTC+3)
  const mskDate = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  const day = mskDate.getDate().toString().padStart(2, '0');
  const month = (mskDate.getMonth() + 1).toString().padStart(2, '0');
  const year = mskDate.getFullYear();
  const hours = mskDate.getHours().toString().padStart(2, '0');
  const minutes = mskDate.getMinutes().toString().padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

// Форматирование даты и времени по МСК
function formatDateMSK(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const mskDate = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  const day = mskDate.getDate().toString().padStart(2, '0');
  const month = (mskDate.getMonth() + 1).toString().padStart(2, '0');
  const year = mskDate.getFullYear();
  const hours = mskDate.getHours().toString().padStart(2, '0');
  const minutes = mskDate.getMinutes().toString().padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

// ============= СИСТЕМА МУТОВ =============

// Загрузка мутов из файла
function loadMutes() {
  try {
    if (fs.existsSync(MUTES_FILE)) {
      const data = fs.readFileSync(MUTES_FILE, 'utf8');
      const parsed = JSON.parse(data);

      // Очищаем истекшие муты
      const now = Date.now();
      for (const [key, muteInfo] of Object.entries(parsed)) {
        if (muteInfo.endDate > now) {
          storage.mutes.set(key, muteInfo);
        }
      }

      console.log('[VK Bot] Муты загружены:', storage.mutes.size, 'активных');
    }
  } catch (error) {
    console.error('[VK Bot] Ошибка загрузки мутов:', error.message);
  }
}

// Сохранение мутов в файл
function saveMutes() {
  try {
    const data = {};
    for (const [key, muteInfo] of storage.mutes.entries()) {
      data[key] = muteInfo;
    }
    fs.writeFileSync(MUTES_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('[VK Bot] Ошибка сохранения мутов:', error.message);
  }
}

// Добавление мута
function addMute(peerId, userId, minutes, reason, mutedBy) {
  const now = Date.now();
  const endDate = now + minutes * 60 * 1000;
  const key = `${peerId}_${userId}`;

  storage.mutes.set(key, {
    endDate,
    reason,
    mutedAt: now,
    mutedBy,
  });

  saveMutes();
  console.log('[VK Bot] Пользователь', userId, 'замучен в чате', peerId, 'до', formatBanEndDate(endDate));
}

// Проверка, замучен ли пользователь в чате
function isUserMuted(peerId, userId) {
  const key = `${peerId}_${userId}`;
  const muteInfo = storage.mutes.get(key);

  if (!muteInfo) return null;

  const now = Date.now();
  if (muteInfo.endDate > now) {
    return muteInfo;
  }

  // Мут истек
  storage.mutes.delete(key);
  saveMutes();
  return null;
}

// Удаление мута
function removeMute(peerId, userId) {
  const key = `${peerId}_${userId}`;
  const deleted = storage.mutes.delete(key);
  if (deleted) {
    saveMutes();
    console.log('[VK Bot] Мут снят с пользователя', userId, 'в чате', peerId);
  }
  return deleted;
}

// Парсинг длительности мута (например: "1 час", "30 минут", "2 часа")
function parseMuteDuration(text) {
  text = text.toLowerCase().trim();

  // Минуты
  if (text.match(/(\d+)\s*(мин|минут|минуты|м|min)/)) {
    const match = text.match(/(\d+)/);
    return parseInt(match[1]);
  }

  // Часы
  if (text.match(/(\d+)\s*(час|часа|часов|ч|h|hour)/)) {
    const match = text.match(/(\d+)/);
    return parseInt(match[1]) * 60;
  }

  // Дни
  if (text.match(/(\d+)\s*(день|дня|дней|д|d|day)/)) {
    const match = text.match(/(\d+)/);
    return parseInt(match[1]) * 60 * 24;
  }

  return null;
}

console.log('[VK Bot] Проверка конфигурации...');
console.log('[VK Bot] Чаты:', CHATS);

if (!VK_GROUP1_TOKEN || !VK_GROUP1_ID) {
  console.error('[VK Bot] Не установлены VK_GROUP1_TOKEN или VK_GROUP1_ID');
  process.exit(1);
}

console.log('[VK Bot] ℹ️  Команда !кик использует GROUP TOKEN');
console.log('[VK Bot] ℹ️  Группа должна быть администратором во ВСЕХ чатах проекта');
console.log('[VK Bot] ℹ️  Проверьте права через команду !диагностика');

// ============= VK API =============

// Для управления чатами теперь используется GROUP TOKEN
// Группа должна быть администратором во всех чатах

async function callVK(method, params = {}, useGroup2 = false, useUserToken = false) {
  // Для методов groups.ban и groups.getBanned нужен USER TOKEN
  // Для остальных методов используем GROUP TOKEN (группа должна быть админом в чатах)
  let token;

  if (useUserToken && VK_USER_TOKEN) {
    token = VK_USER_TOKEN;
  } else {
    token = useGroup2 ? VK_GROUP2_TOKEN : VK_GROUP1_TOKEN;
  }

  const url = `https://api.vk.com/method/${method}`;
  const body = new URLSearchParams({
    ...params,
    access_token: token,
    v: VK_API_VERSION,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json();
  if (data.error) throw new Error(`VK API Error: ${data.error.error_msg}`);
  return data.response;
}

async function sendMessage(peerId, message, params = {}) {
  try {
    await callVK('messages.send', {
      peer_id: peerId,
      message: message,
      random_id: Math.floor(Math.random() * 1000000000),
      ...params,
    });
  } catch (error) {
    console.error('[VK Bot] Ошибка отправки сообщения:', error.message);
  }
}

async function getUser(userId) {
  try {
    const users = await callVK('users.get', { user_ids: userId });
    return users[0];
  } catch (error) {
    console.error('[VK Bot] Ошибка получения пользователя:', error.message);
    return null;
  }
}

async function getLongPollServer() {
  return await callVK('groups.getLongPollServer', { group_id: VK_GROUP1_ID });
}

// ============= УТИЛИТЫ =============

function extractUserId(link) {
  const patterns = [
    /vk\.com\/id(\d+)/,
    /\[vk\.com\/id(\d+)\|/,
    /^id(\d+)$/,
    /^(\d+)$/,
  ];

  for (const pattern of patterns) {
    const match = link.match(pattern);
    if (match) return parseInt(match[1]);
  }
  return null;
}

function createUserLink(user) {
  return `[vk.com/id${user.id}|${user.first_name} ${user.last_name}]`;
}

function peerIdToChatId(peerId) {
  return peerId - 2000000000;
}

function chatIdToPeerId(chatId) {
  return chatId + 2000000000;
}

function formatDate() {
  const now = new Date();
  const day = now.getDate().toString().padStart(2, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const year = now.getFullYear();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

function getChatName(peerId) {
  const names = {
    [CHATS.rukovodstvo]: 'Руководство',
    [CHATS.ss]: 'Старший Состав',
    [CHATS.uchebny]: 'Учебный Центр',
    [CHATS.doska]: 'Доска Объявлений',
    [CHATS.dispetcherskaya]: 'Диспетчерская',
    [CHATS.fludilka]: 'Флудилка',
    [CHATS.zhurnal]: 'Журнал Активности',
    [CHATS.sponsor]: 'Спонсорская беседа',
  };
  
  // Ищем по peer_id напрямую
  if (names[peerId]) {
    return names[peerId];
  }
  
  // Если не нашли, возвращаем просто ID чата
  const chatId = peerIdToChatId(peerId);
  return `Чат ${chatId}`;
}

// ============= ПРАВА И РОЛИ =============

// Определяет роль пользователя на основе чата, откуда пришла команда
function getRoleByChat(peerId) {
  const chatId = peerIdToChatId(peerId);

  // Если пишет в чате Руководства - значит РС
  if (chatId === CHATS.rukovodstvo) return 'rs';

  // Если пишет в чате СС - может быть РС или СС, проверим дополнительно
  if (chatId === CHATS.ss) return 'ss';

  // Если в других чатах - проверим по списку доступа
  if (chatId === CHATS.fludilka || chatId === CHATS.dispetcherskaya || chatId === CHATS.zhurnal || chatId === CHATS.doska) {
    return 'kurier'; // П�� умолчанию курьер, если есть доступ к эти�� чатам
  }

  if (chatId === CHATS.uchebny) return 'stazher';
  if (chatId === CHATS.sponsor) return 'sponsor';

  return null;
}

// Проверяет права на основе роли из текущего чата
async function hasPermission(userId, peerId, requiredRoles) {
  const role = getRoleByChat(peerId);

  console.log(`[v0] Проверка прав: пользователь ${userId}, чат ${peerIdToChatId(peerId)}, роль: ${role}, требуется: ${requiredRoles.join('/')}`);

  // Если роль не определена по чату - проверим является ли админом беседы
  if (!role) {
    const isAdmin = await isChatAdmin(peerId, userId);
    if (isAdmin) return true;
  }

  return role && requiredRoles.includes(role);
}

// Проверка администратора беседы (владелец или админ VK)
async function isChatAdmin(peerId, userId) {
  try {
    const members = await callVK('messages.getConversationMembers', {
      peer_id: peerId,
    });
    const member = members.items.find(m => m.member_id === userId);
    return member && (member.is_admin || member.is_owner);
  } catch (error) {
    return false;
  }
}

async function getUserRole(userId) {
  try {
    // Получаем все беседы и проверяем в каких состоит пользователь
    const userChatIds = [];

    console.log(`[v0] getUserRole для пользователя ${userId}`);

    for (const [chatName, chatPeerId] of Object.entries(CHATS)) {
      if (!chatPeerId || chatPeerId === 0) continue;

      try {
        // chatPeerId уже является peer_id, не нужно преобразовывать
        const members = await callVK('messages.getConversationMembers', {
          peer_id: chatPeerId,
        });
        const isMember = members.items.some(m => m.member_id === userId);
        console.log(`[v0] ${chatName} (peer_id=${chatPeerId}): пользователь ${isMember ? 'найден' : 'не найден'}`);
        if (isMember) {
          userChatIds.push(chatPeerId);
        }
      } catch (e) {
        console.log(`[v0] ${chatName}: ошибка проверки - ${e.message}`);
        // Пропускаем чаты к которым нет доступа
      }
    }

    console.log(`[v0] Пользователь состоит в чатах:`, userChatIds);

    // Определяем роль по приоритету
    if (userChatIds.includes(CHATS.rukovodstvo)) return 'rs';
    if (userChatIds.includes(CHATS.ss)) return 'ss';
    if (userChatIds.includes(CHATS.fludilka)) return 'kurier';
    if (userChatIds.includes(CHATS.uchebny)) return 'stazher';

    return null;
  } catch (error) {
    console.error('[VK Bot] Ошибка определения роли:', error.message);
    return null;
  }
}

// ============= КОМАНДЫ =============

// !пост - публикация в группу 2
async function cmdPost(ctx) {
  // Доступно РС и СС в любых чатах
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
    return;
  }

  if (!ctx.replyMessage) {
    await sendMessage(ctx.peerId, 'Ответьте на сообщение, которое нужно опубликовать');
    return;
  }

  try {
    const msg = ctx.replyMessage;
    const text = msg.text || '';
    const attachments = [];

    console.log('[v0] cmdPost: Обрабатываем сообщение с вложениями:', msg.attachments?.length || 0);

    // Собираем вложения
    if (msg.attachments) {
      for (const att of msg.attachments) {
        console.log('[v0] cmdPost: Тип вложения:', att.type);
        
        if (att.type === 'photo') {
          // У фото берем access_key если есть
          let photoId = `photo${att.photo.owner_id}_${att.photo.id}`;
          if (att.photo.access_key) {
            photoId += `_${att.photo.access_key}`;
          }
          console.log('[v0] cmdPost: Добавляем фото:', photoId);
          attachments.push(photoId);
        } else if (att.type === 'video') {
          let videoId = `video${att.video.owner_id}_${att.video.id}`;
          if (att.video.access_key) {
            videoId += `_${att.video.access_key}`;
          }
          console.log('[v0] cmdPost: Добавляем видео:', videoId);
          attachments.push(videoId);
        } else if (att.type === 'doc') {
          let docId = `doc${att.doc.owner_id}_${att.doc.id}`;
          if (att.doc.access_key) {
            docId += `_${att.doc.access_key}`;
          }
          console.log('[v0] cmdPost: Добавляем документ:', docId);
          attachments.push(docId);
        } else if (att.type === 'audio') {
          const audioId = `audio${att.audio.owner_id}_${att.audio.id}`;
          console.log('[v0] cmdPost: Добавляем аудио:', audioId);
          attachments.push(audioId);
        }
      }
    }

    console.log('[v0] cmdPost: Всего вложений собрано:', attachments.length);

    // Публикуем на стену группы 2
    const postParams = {
      owner_id: -VK_GROUP2_ID,
      message: text,
      from_group: 1,
    };
    
    if (attachments.length > 0) {
      postParams.attachments = attachments.join(',');
      console.log('[v0] cmdPost: Параметр attachments:', postParams.attachments);
    }

    const result = await callVK('wall.post', postParams, true);
    console.log('[v0] cmdPost: Пост опубликован, ID:', result.post_id);

    await sendMessage(ctx.peerId, 'Пост успешно опубликован в группе');
  } catch (error) {
    console.error('[v0] cmdPost: Ошибка публикации:', error);
    await sendMessage(ctx.peerId, `Ошибка публикации: ${error.message}`);
  }
}

// !приказ - пост в доску объявлений группы 1
async function cmdPrikaz(ctx) {
  // Доступно РС и СС в любых чатах
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
    return;
  }

  if (!ctx.replyMessage) {
    await sendMessage(ctx.peerId, 'Ответьте на сообщение, которое нужно опубликовать');
    return;
  }

  try {
    // Пересылаем сообщение на стену группы 1 в доску объявлений
    // В VK API нет прямого способа переслать в доску объявлений
    // Но можно создать пост с тем же содержимым
    const msg = ctx.replyMessage;
    const text = msg.text || '';
    const attachments = [];

    // Собираем вложения
    if (msg.attachments) {
      for (const att of msg.attachments) {
        if (att.type === 'photo') {
          let photoId = `photo${att.photo.owner_id}_${att.photo.id}`;
          if (att.photo.access_key) {
            photoId += `_${att.photo.access_key}`;
          }
          attachments.push(photoId);
        } else if (att.type === 'video') {
          let videoId = `video${att.video.owner_id}_${att.video.id}`;
          if (att.video.access_key) {
            videoId += `_${att.video.access_key}`;
          }
          attachments.push(videoId);
        } else if (att.type === 'doc') {
          let docId = `doc${att.doc.owner_id}_${att.doc.id}`;
          if (att.doc.access_key) {
            docId += `_${att.doc.access_key}`;
          }
          attachments.push(docId);
        }
      }
    }

    // Публикуем в доску объявлений (запись "Предложить новость" от лица группы)
    const postParams = {
      owner_id: -VK_GROUP1_ID,
      message: text,
      from_group: 1,
    };

    if (attachments.length > 0) {
      postParams.attachments = attachments.join(',');
    }

    await callVK('wall.post', postParams, false);

    await sendMessage(ctx.peerId, 'Приказ успешно опубликован в доску объявлений группы');
  } catch (error) {
    await sendMessage(ctx.peerId, `Ошибка публикации: ${error.message}`);
  }
}

// ��ункция для распознавания алиасов чатов
function getChatIdByAlias(alias) {
  const aliases = {
    'рс': CHATS.rukovodstvo,
    'сс': CHATS.ss,
    'уц': CHATS.uchebny,
    'до': CHATS.doska,
    'дисп': CHATS.dispetcherskaya,
    'диспетчерская': CHATS.dispetcherskaya,
    'флуд': CHATS.fludilka,
    'жа': CHATS.zhurnal,
    'журнал': CHATS.zhurnal,
    'спонсор': CHATS.sponsor,
  };
  return aliases[alias.toLowerCase()];
}

// !приветствие - установка приветствия
async function cmdGreeting(ctx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС');
    return;
  }

  if (!ctx.replyMessage) {
    await sendMessage(ctx.peerId, 'Ответьте на сообщение с текстом приветствия');
    return;
  }

  // Проверяем, указан ли алиас чата
  let targetPeerId = ctx.peerId; // По умолчанию текущий чат
  if (ctx.args.length >= 2) {
    const chatAlias = ctx.args[1];
    const chatId = getChatIdByAlias(chatAlias);
    if (chatId) {
      targetPeerId = chatIdToPeerId(chatId);
    } else {
      await sendMessage(ctx.peerId,
        'Неизвестный чат. Доступные: рс, сс, уц, до, дисп, флуд, жа, спонсор\n' +
        'Или используйте без параметра для текущего чата'
      );
      return;
    }
  }

  const greetingText = ctx.replyMessage.text || '';
  const attachments = [];

  // Собираем вложения из сообщения
  if (ctx.replyMessage.attachments) {
    for (const att of ctx.replyMessage.attachments) {
      if (att.type === 'photo') {
        let photoId = `photo${att.photo.owner_id}_${att.photo.id}`;
        if (att.photo.access_key) photoId += `_${att.photo.access_key}`;
        attachments.push(photoId);
      } else if (att.type === 'video') {
        let videoId = `video${att.video.owner_id}_${att.video.id}`;
        if (att.video.access_key) videoId += `_${att.video.access_key}`;
        attachments.push(videoId);
      } else if (att.type === 'doc') {
        let docId = `doc${att.doc.owner_id}_${att.doc.id}`;
        if (att.doc.access_key) docId += `_${att.doc.access_key}`;
        attachments.push(docId);
      }
    }
  }

  // Сохраняем приветствие с вложениями
  storage.greetings.set(targetPeerId, {
    text: greetingText,
    attachments: attachments,
  });

  const chatName = getChatName(targetPeerId);
  const attText = attachments.length > 0 ? ` (с ${attachments.length} вложениями)` : '';
  await sendMessage(ctx.peerId, `Приветствие установлено для чата "${chatName}"${attText}`);
}

// !закреп - закрепление сообщения
async function cmdPin(ctx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС');
    return;
  }

  if (!ctx.replyMessage) {
    await sendMessage(ctx.peerId, 'Ответьте на сообщение, которое нужно закрепить');
    return;
  }

  // Проверяем, указан ли алиас чата
  let targetPeerId = ctx.peerId; // По умолчанию текущий чат
  let targetChatAlias = null;
  
  if (ctx.args.length >= 2) {
    const chatAlias = ctx.args[1];
    const chatId = getChatIdByAlias(chatAlias);
    if (chatId) {
      targetPeerId = chatId; // chatId уже в формате peer_id (2000000000 + chat_id)
      targetChatAlias = chatAlias;
    } else {
      await sendMessage(ctx.peerId,
        'Неизвестный чат. Доступные: рс, сс, уц, до, дисп, флуд, жа, спонсор\n' +
        'Или используйте без параметра для текущего чата'
      );
      return;
    }
  }

  try {
    // Если закрепляем в другом чате - копируем сообщение туда
    if (targetChatAlias) {
      const msg = ctx.replyMessage;
      const text = msg.text || '';
      const attachments = [];

      // Собираем вложения
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.type === 'photo') {
            let photoId = `photo${att.photo.owner_id}_${att.photo.id}`;
            if (att.photo.access_key) photoId += `_${att.photo.access_key}`;
            attachments.push(photoId);
          } else if (att.type === 'video') {
            let videoId = `video${att.video.owner_id}_${att.video.id}`;
            if (att.video.access_key) videoId += `_${att.video.access_key}`;
            attachments.push(videoId);
          } else if (att.type === 'doc') {
            let docId = `doc${att.doc.owner_id}_${att.doc.id}`;
            if (att.doc.access_key) docId += `_${att.doc.access_key}`;
            attachments.push(docId);
          }
        }
      }

      // Отправляем сообщение в целевой чат
      const sendParams = {
        peer_id: targetPeerId,
        message: text,
        random_id: Math.floor(Math.random() * 1000000000),
      };
      
      if (attachments.length > 0) {
        sendParams.attachment = attachments.join(',');
      }

      const messageId = await callVK('messages.send', sendParams);
      
      // Получаем информацию о сообщении через messages.getById
      const messages = await callVK('messages.getById', {
        message_ids: messageId,
      });
      
      if (messages.items && messages.items.length > 0) {
        const conversationMessageId = messages.items[0].conversation_message_id;
        
        // Закрепляем отправленное сообщение используя только conversation_message_id
        await callVK('messages.pin', {
          peer_id: targetPeerId,
          conversation_message_id: conversationMessageId,
        });
      }

      const chatName = getChatName(targetPeerId);
      await sendMessage(ctx.peerId, `Сообщение отправлено и закреплено в чате "${chatName}"`);
    } else {
      // Закрепляем в текущем чате
      await callVK('messages.pin', {
        peer_id: targetPeerId,
        conversation_message_id: ctx.replyMessage.conversation_message_id,
      });

      await sendMessage(ctx.peerId, 'Сообщение закреплено');
    }
  } catch (error) {
    console.error('[VK Bot] Ошибка закрепления:', error);
    await sendMessage(ctx.peerId, `Ошибка закрепления: ${error.message}`);
  }
}

// !кик - удаление пользователя
async function cmdKick(ctx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
    return;
  }

  if (ctx.args.length < 2) {
    await sendMessage(ctx.peerId, 'Использование:\n!кик [ссылка] [дни_бана]\n!кик [ссылка] perm - перманентный бан\n!кик [ссылка] спонсор - кик только из спонсорской беседы');
    return;
  }

  const targetUserId = extractUserId(ctx.args[1]);
  if (!targetUserId) {
    await sendMessage(ctx.peerId, 'Не удалось извлечь ID пользователя из ссылки');
    return;
  }

  const targetUser = await getUser(targetUserId);
  if (!targetUser) {
    await sendMessage(ctx.peerId, 'Пользователь не найден');
    return;
  }

  const userLink = createUserLink(targetUser);

  // Проверяем, это кик из спонсорской беседы?
  const isSponsorKick = ctx.args[2] === 'спонсор';

  if (isSponsorKick) {
    // Кикаем только из спонсорской беседы
    try {
      await callVK('messages.removeChatUser', {
        chat_id: getChatId(CHATS.sponsor),
        member_id: targetUserId,
      });
      await sendMessage(ctx.peerId, `${userLink} удалён из Спонсорской беседы`);
    } catch (error) {
      const errorMsg = error.message.includes('Access denied')
        ? 'Группа не является администратором спонсорской беседы. Добавьте группу как администратора!'
        : `Ошибка удаления: ${error.message}`;
      await sendMessage(ctx.peerId, errorMsg);
    }
    return;
  }

  // Обычный кик из всех чатов
  // Поддержка "perm", "перманент" для перманентного бана
  const banArg = ctx.args[2]?.toLowerCase();
  let banDays = 0;

  if (banArg === 'perm' || banArg === 'перманент') {
    banDays = 999; // 999 = перманент
  } else {
    banDays = parseInt(ctx.args[2]) || 0;
  }

  // Удаляем из всех чатов
  const allChats = Object.values(CHATS).filter(id => id > 0);
  let removed = 0;

  for (const chatPeerId of allChats) {
    try {
      await callVK('messages.removeChatUser', {
        chat_id: getChatId(chatPeerId),
        member_id: targetUserId,
      });
      removed++;
    } catch (error) {
      console.error(`[VK Bot] Не удалось удалить из чата ${chatPeerId}:`, error.message);
    }
  }

  // Добавляем в локальный ЧС если указаны дни
  if (banDays > 0) {
    const finalDays = banDays === 999 ? 0 : banDays; // 0 = перманентный бан
    const initiator = await getUser(ctx.userId);
    const initiatorName = initiator ? `${initiator.first_name} ${initiator.last_name}` : `ID${ctx.userId}`;
    addToLocalBlacklist(targetUserId, finalDays, `Кик через команду !кик (${initiatorName})`, ctx.userId);
  }

  let banText = '';
  if (banDays > 0) {
    const banEndDate = banDays === 999 ? 0 : Date.now() + banDays * 24 * 60 * 60 * 1000;
    const banEndText = formatBanEndDate(banEndDate);
    banText = `. Занесён в ЧС до ${banEndText}`;
  }

  await sendMessage(ctx.peerId, `${userLink} кикнут из всех чатов (удалён из ${removed})${banText}`);

  // Логируем в Руководство (только если команда была не из чата руководства)
  if (ctx.peerId !== CHATS.rukovodstvo && CHATS.rukovodstvo > 0) {
    const initiator = await getUser(ctx.userId);
    if (initiator) {
      const log = `[${formatDateMSK()}] [КИК]\n${userLink} кикнут ${createUserLink(initiator)}${banText}`;
      await sendMessage(CHATS.rukovodstvo, log);
    }
  }
}

// !чат - узнать ID текущего чата
async function cmdChatInfo(ctx) {
  const chatId = peerIdToChatId(ctx.peerId);
  const chatName = getChatName(ctx.peerId);

  await sendMessage(ctx.peerId,
    `Информация о чате:\n` +
    `Название: ${chatName}\n` +
    `Chat ID: ${chatId}\n` +
    `Peer ID: ${ctx.peerId}`
  );
}

// !увед - массовое уведомление
async function cmdNotify(ctx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
    return;
  }

  try {
    const members = await callVK('messages.getConversationMembers', {
      peer_id: ctx.peerId,
    });

    const userIds = members.items
      .filter(item => item.member_id > 0)
      .map(item => item.member_id);

    // VK позволяет упоминать до 10 пользователей за раз
    const chunks = [];
    for (let i = 0; i < userIds.length; i += 10) {
      chunks.push(userIds.slice(i, i + 10));
    }

    for (const chunk of chunks) {
      const mentions = chunk.map(id => `[id${id}|.]`).join(' ');
      await sendMessage(ctx.peerId, mentions);
    }

    await sendMessage(ctx.peerId, `Уведомлено ${userIds.length} участников`);
  } catch (error) {
    await sendMessage(ctx.peerId, `Ошибка уведомления: ${error.message}`);
  }
}

// Маппинг команд
// !ди��гностика - проверка токена и прав в чатах
async function cmdDiagnostics(ctx) {
  if (!await hasPermission(ctx.userId, ctx.peerId, ['rs'])) {
    await sendMessage(ctx.peerId, 'Недостаточно прав. Доступно только для РС.');
    return;
  }

  let report = '🔍 Диагностика управления чатами:\n\n';
  let groupId = null;

  // Получаем информацию о группе
  report += '🔑 Управление чатами через GROUP TOKEN\n';
  try {
    const groups = await callVK('groups.getById', {});
    if (groups && groups[0]) {
      groupId = -groups[0].id; // Группы имеют отрицательный ID
      report += `✓ Группа: ${groups[0].name} (ID: ${groupId})\n`;
      report += `ℹ️ Группа должна быть администратором во всех чатах\n\n`;
    }
  } catch (error) {
    report += `❌ Ошибка получения информации о группе: ${error.message}\n\n`;
  }

  // Проверяем каждый чат
  report += '📋 Проверка чатов:\n';
  for (const [chatName, chatPeerId] of Object.entries(CHATS)) {
    if (!chatPeerId || chatPeerId === 0) {
      report += `- ${chatName}: не настроен\n`;
      continue;
    }

    try {
      const chatId = getChatId(chatPeerId);

      // Получаем информацию о чате
      const chatInfo = await callVK('messages.getConversationsById', {
        peer_ids: chatPeerId,
      });

      if (chatInfo.items && chatInfo.items[0]) {
        const chat = chatInfo.items[0];
        const settings = chat.chat_settings;

        // Проверяем права администратора группы
        let isAdmin = false;
        if (groupId) {
          try {
            const members = await callVK('messages.getConversationMembers', {
              peer_id: chatPeerId,
            });
            const member = members.items.find(m => m.member_id === groupId);
            isAdmin = member && (member.is_admin || member.is_owner);
          } catch (e) {
            // Не можем проверить права
          }
        }

        const adminStatus = isAdmin ? '✓ группа админ' : '❌ группа НЕ админ';
        report += `- ${chatName}: ✓ доступ, ${adminStatus} (chat_id=${chatId}, участников=${settings?.members_count || '?'})\n`;
      } else {
        report += `- ${chatName}: ⚠️ информация недоступна\n`;
      }
    } catch (error) {
      report += `- ${chatName}: ❌ ${error.message}\n`;
    }
  }

  await sendMessage(ctx.peerId, report);
}

// !чс - управление локальным черным списком
async function cmdBlacklist(ctx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
    return;
  }

  const subcommand = ctx.args[1]?.toLowerCase();

  // !чс список - показать всех в ЧС
  if (subcommand === 'список' || !subcommand) {
    if (storage.localBlacklist.size === 0) {
      await sendMessage(ctx.peerId, 'Локальный ЧС пуст');
      return;
    }

    let list = `Локальный ЧС (${storage.localBlacklist.size} пользователей):\n\n`;
    let index = 1;

    for (const [userId, banInfo] of storage.localBlacklist.entries()) {
      const user = await getUser(userId);
      const userLink = user ? createUserLink(user) : `[id${userId}|ID${userId}]`;
      const banEndText = formatBanEndDate(banInfo.endDate);
      const bannedDate = formatDateMSK(banInfo.bannedAt);

      // Получаем информацию о том, кто забанил
      let bannedByText = 'Неизвестно';
      if (banInfo.bannedBy) {
        const bannedByUser = await getUser(banInfo.bannedBy);
        bannedByText = bannedByUser ? createUserLink(bannedByUser) : `ID${banInfo.bannedBy}`;
      }

      list += `${index}. ${userLink}\n`;
      list += `   До: ${banEndText}\n`;
      list += `   Забанен: ${bannedDate} МСК\n`;
      list += `   Кем: ${bannedByText}\n`;
      list += `   Причина: ${banInfo.reason}\n\n`;
      index++;
    }

    await sendMessage(ctx.peerId, list);
    return;
  }

  // !чс разбан [ссылка] - удалить из ЧС
  if (subcommand === 'разбан') {
    if (ctx.args.length < 3) {
      await sendMessage(ctx.peerId, 'Использование: !чс разбан [ссылка на пользователя]');
      return;
    }

    const targetUserId = extractUserId(ctx.args[2]);
    if (!targetUserId) {
      await sendMessage(ctx.peerId, 'Не удалось извлечь ID пользователя из ссылки');
      return;
    }

    const removed = removeFromLocalBlacklist(targetUserId);
    if (removed) {
      const user = await getUser(targetUserId);
      const userName = user ? createUserLink(user) : `ID${targetUserId}`;
      await sendMessage(ctx.peerId, `${userName} удален из локального ЧС`);
    } else {
      await sendMessage(ctx.peerId, `Пользователь ID${targetUserId} не найден в локальном ЧС`);
    }
    return;
  }

  // !чс проверка [ссылка] - проверить пользователя
  if (subcommand === 'проверка') {
    if (ctx.args.length < 3) {
      await sendMessage(ctx.peerId, 'Использование: !чс проверка [ссылка на пользователя]');
      return;
    }

    const targetUserId = extractUserId(ctx.args[2]);
    if (!targetUserId) {
      await sendMessage(ctx.peerId, 'Не удалось извлечь ID пользователя из ссылки');
      return;
    }

    const banInfo = isUserInLocalBlacklist(targetUserId);
    const user = await getUser(targetUserId);
    const userName = user ? createUserLink(user) : `[id${targetUserId}|ID${targetUserId}]`;

    if (banInfo) {
      const banEndText = formatBanEndDate(banInfo.endDate);
      const bannedDate = formatDateMSK(banInfo.bannedAt);

      let bannedByText = 'Неизвестно';
      if (banInfo.bannedBy) {
        const bannedByUser = await getUser(banInfo.bannedBy);
        bannedByText = bannedByUser ? createUserLink(bannedByUser) : `ID${banInfo.bannedBy}`;
      }

      await sendMessage(ctx.peerId, `${userName} в локальном ЧС:\n\nДо: ${banEndText}\nЗабанен: ${bannedDate} МСК\nКем: ${bannedByText}\nПричина: ${banInfo.reason}`);
    } else {
      await sendMessage(ctx.peerId, `${userName} НЕ в локальном ЧС`);
    }
    return;
  }

  await sendMessage(ctx.peerId, 'Использование:\n!чс список - показать всех в ЧС\n!чс разбан [ссылка] - удалить из ЧС\n!чс проверка [ссылка] - проверить пользователя');
}

// !мут - мут пользователя в чате
async function cmdMute(ctx) {
  // Проверка доступа: СС и РС везде, но в чате СС только РС, в чате РС никто
  if (ctx.peerId === CHATS.rukovodstvo) {
    await sendMessage(ctx.peerId, 'В чате Руководства команда !мут недоступна');
    return;
  }

  if (ctx.peerId === CHATS.ss) {
    // В чат�� СС только РС
    if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs']))) {
      await sendMessage(ctx.peerId, 'В чате СС команда доступна только РС');
      return;
    }
  } else {
    // В остальных чатах СС и РС
    if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
      await sendMessage(ctx.peerId, 'Команда д��ступна только РС и СС');
      return;
    }
  }

  // Определяем пользователя (из ответа или из аргумента)
  let targetUserId = null;

  if (ctx.replyMessage) {
    targetUserId = ctx.replyMessage.from_id;
  } else if (ctx.args.length >= 2) {
    targetUserId = extractUserId(ctx.args[1]);
  }

  if (!targetUserId) {
    await sendMessage(ctx.peerId, 'Использование: !мут [ссылка|@mention] [время] [причина]\nИли ответьте на сообщение: !мут [время] [причина]\n\nПример: !мут @id123 1 час Флуд');
    return;
  }

  // Определяем длительность и причину
  let duration = null;
  let reason = 'Нарушение правил';

  if (ctx.replyMessage) {
    // !мут [время] [причина]
    if (ctx.args.length >= 2) {
      const durationText = ctx.args.slice(1, 3).join(' '); // "1 час" или "30 минут"
      duration = parseMuteDuration(durationText);

      if (ctx.args.length >= 4) {
        reason = ctx.args.slice(3).join(' ');
      } else if (ctx.args.length === 3) {
        // Проверяем, не является ли третий аргумент причиной
        const possibleReason = ctx.args[2];
        if (!possibleReason.match(/\d/)) {
          reason = possibleReason;
        }
      }
    }
  } else {
    // !мут [ссылка] [время] [причина]
    if (ctx.args.length >= 3) {
      const durationText = ctx.args.slice(2, 4).join(' '); // "1 час" или "30 минут"
      duration = parseMuteDuration(durationText);

      if (ctx.args.length >= 5) {
        reason = ctx.args.slice(4).join(' ');
      } else if (ctx.args.length === 4) {
        const possibleReason = ctx.args[3];
        if (!possibleReason.match(/\d/)) {
          reason = possibleReason;
        }
      }
    }
  }

  if (!duration || duration <= 0) {
    await sendMessage(ctx.peerId, 'Некорректное время мута. Примеры: "1 час", "30 минут", "2 дня"');
    return;
  }

  try {
    // Используем VK API для ограничения прав в чате
    await callVK('messages.setMemberRole', {
      peer_id: ctx.peerId,
      member_id: targetUserId,
      role: 'restricted',
    });

    // Добавляем мут в локальное хранилище для отслеживания времени
    addMute(ctx.peerId, targetUserId, duration, reason, ctx.userId);

    const user = await getUser(targetUserId);
    const userLink = user ? createUserLink(user) : `[id${targetUserId}|ID${targetUserId}]`;
    const endDate = Date.now() + duration * 60 * 1000;
    const endDateText = formatBanEndDate(endDate);

    await sendMessage(ctx.peerId, `${userLink} замучен до ${endDateText}\nПричина: ${reason}`);

    // Логируем в Руководство (если команда не из руководства)
    if (ctx.peerId !== CHATS.rukovodstvo && CHATS.rukovodstvo > 0) {
      const initiator = await getUser(ctx.userId);
      if (initiator) {
        const chatName = getChatName(ctx.peerId);
        const log = `[${formatDateMSK()}] [МУТ]\n${userLink} замучен в чате "${chatName}" до ${endDateText}\nМодератор: ${createUserLink(initiator)}\nПричина: ${reason}`;
        await sendMessage(CHATS.rukovodstvo, log);
      }
    }

    // Устанавливаем таймер для автоматического размута
    setTimeout(async () => {
      const stillMuted = isUserMuted(ctx.peerId, targetUserId);
      if (stillMuted) {
        try {
          await callVK('messages.setMemberRole', {
            peer_id: ctx.peerId,
            member_id: targetUserId,
            role: 'member',
          });
          removeMute(ctx.peerId, targetUserId);
          console.log('[VK Bot] Автоматически снят мут с пользователя', targetUserId, 'в чате', ctx.peerId);
        } catch (error) {
          console.error('[VK Bot] Ошибка автоматического размута:', error.message);
        }
      }
    }, duration * 60 * 1000);
  } catch (error) {
    console.error('[VK Bot] Ошибка мута:', error);
    await sendMessage(ctx.peerId, `Ошибка мута: ${error.message}`);
  }
}

// !размут - снятие мута с пользователя
async function cmdUnmute(ctx) {
  // Проверка доступа: СС и РС везде, но в чате СС только РС, в чате РС никто
  if (ctx.peerId === CHATS.rukovodstvo) {
    await sendMessage(ctx.peerId, 'В чате Руководства команда !размут недоступна');
    return;
  }

  if (ctx.peerId === CHATS.ss) {
    if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs']))) {
      await sendMessage(ctx.peerId, 'В чате СС команда доступна только РС');
      return;
    }
  } else {
    if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
      await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
      return;
    }
  }

  // Определяем пользователя
  let targetUserId = null;
  
  if (ctx.replyMessage) {
    targetUserId = ctx.replyMessage.from_id;
  } else if (ctx.args.length >= 2) {
    targetUserId = extractUserId(ctx.args[1]);
  }

  if (!targetUserId) {
    await sendMessage(ctx.peerId, 'Использование: !размут [ссылка|@mention]\nИли ответьте на сообщение пользователя');
    return;
  }

  try {
    // Снимаем ограничение через VK API
    await callVK('messages.setMemberRole', {
      peer_id: ctx.peerId,
      member_id: targetUserId,
      role: 'member',
    });

    // Удаляем из локального хранилища
    removeMute(ctx.peerId, targetUserId);

    const user = await getUser(targetUserId);
    const userLink = user ? createUserLink(user) : `[id${targetUserId}|ID${targetUserId}]`;

    await sendMessage(ctx.peerId, `С ${userLink} снят мут`);
  } catch (error) {
    console.error('[VK Bot] Ошибка размута:', error);
    await sendMessage(ctx.peerId, `Ошибка размута: ${error.message}`);
  }
}

const commands = {
  'пост': cmdPost,
  'приветствие': cmdGreeting,
  'закреп': cmdPin,
  'кик': cmdKick,
  'чат': cmdChatInfo,
  'увед': cmdNotify,
  'диагностика': cmdDiagnostics,
  'чс': cmdBlacklist,
  'мут': cmdMute,
  'размут': cmdUnmute,
  'приказ': cmdPrikaz,
};

// ============= СОБЫТИЯ =============

// Приветствие новых участников + Автокик пользователей из ЧС
async function handleChatJoin(message) {
  const userId = message.action.member_id;

  console.log('[VK Bot] handleChatJoin: userId =', userId, 'peerId =', message.peer_id);

  const user = await getUser(userId);
  if (!user) {
    console.log('[VK Bot] Не удалось получить пользователя', userId);
    return;
  }

  // Проверяем, находится ли пользователь в локальном ЧС
  const banInfo = isUserInLocalBlacklist(userId);
  console.log('[VK Bot] Пользователь', userId, 'в локальном ЧС:', !!banInfo);

  // Если пользователь в ЧС - автоматически кикаем
  if (banInfo) {
    console.log('[VK Bot] Начинаем автокик пользователя', userId, 'до', formatBanEndDate(banInfo.endDate));
    try {
      await callVK('messages.removeChatUser', {
        chat_id: getChatId(message.peer_id),
        member_id: userId,
      });

      const userLink = createUserLink(user);
      const banEndText = formatBanEndDate(banInfo.endDate);
      await sendMessage(message.peer_id, `${userLink} автома��ически удалён (в ЧС до ${banEndText})`);

      // Логируем в Руководство
      if (CHATS.rukovodstvo && CHATS.rukovodstvo > 0) {
        const log = `[${formatDateMSK()}] [АВТОКИК]\n${userLink} автоматически удалён из беседы\nПричина: в ЧС до ${banEndText}\nОснование: ${banInfo.reason}`;
        await sendMessage(CHATS.rukovodstvo, log); // Уже peer_id
      }

      console.log('[VK Bot] Пользователь', userId, 'автоматически кикнут (в ЧС)');
      return; // Не отправляем приветствие
    } catch (error) {
      console.error('[VK Bot] Ошибка автокика пользователя из ЧС:', error.message);
    }
  }

  // Если пользователь не в ЧС - отправляем приветствие
  const greeting = storage.greetings.get(message.peer_id);
  if (greeting) {
    // Обработка нового формата приветствий (с вложениями)
    if (typeof greeting === 'object' && greeting.text) {
      const welcomeText = greeting.text.replace('{user}', createUserLink(user));
      await sendMessage(message.peer_id, welcomeText, {
        attachment: greeting.attachments?.join(',') || undefined
      });
    } else if (typeof greeting === 'string') {
      // Поддержка старого формата (только текст)
      const welcomeText = greeting.replace('{user}', createUserLink(user));
      await sendMessage(message.peer_id, welcomeText);
    }
  }
}

// Обработка самолива
async function handleChatLeave(message) {
  const userId = message.action.member_id;
  const user = await getUser(userId);
  if (!user) return;

  const userLink = createUserLink(user);

  // Кикаем из всех чатов
  const allChats = Object.values(CHATS).filter(id => id > 0);
  for (const chatPeerId of allChats) {
    try {
      await callVK('messages.removeChatUser', {
        chat_id: getChatId(chatPeerId),
        member_id: userId,
      });
    } catch (error) {
      // Игнорируем ошибки
    }
  }

  // Отправляем сообщение в Руководство с кнопками
  const keyboard = {
    inline: true,
    buttons: [
      [
        { action: { type: 'callback', label: '30 дней', payload: JSON.stringify({ action: 'ban', userId, days: 30 }) }, color: 'secondary' },
        { action: { type: 'callback', label: '60 дней', payload: JSON.stringify({ action: 'ban', userId, days: 60 }) }, color: 'secondary' },
      ],
      [
        { action: { type: 'callback', label: '90 дней', payload: JSON.stringify({ action: 'ban', userId, days: 90 }) }, color: 'secondary' },
        { action: { type: 'callback', label: '120 дней', payload: JSON.stringify({ action: 'ban', userId, days: 120 }) }, color: 'secondary' },
      ],
      [
        { action: { type: 'callback', label: 'Перманент', payload: JSON.stringify({ action: 'ban', userId, days: 0 }) }, color: 'negative' },
        { action: { type: 'callback', label: 'Нет (вернуть)', payload: JSON.stringify({ action: 'return', userId }) }, color: 'positive' },
      ],
    ],
  };

  console.log('[VK Bot] Отправка самолива в руководство, peer_id:', CHATS.rukovodstvo);

  try {
    await sendMessage(
      CHATS.rukovodstvo, // Уже peer_id, не нужно преобразование
      `[${formatDateMSK()}] [САМОЛИВ]\n${userLink} покинул беседу\n\nЗанести в ЧС?`,
      { keyboard: JSON.stringify(keyboard) }
    );
    console.log('[VK Bot] Самолив успешно отправлен в руководство');
  } catch (error) {
    console.error('[VK Bot] Ошибка отправки самолива:', error.message);
  }
}

// Обработка нажатий на кнопки
async function handleCallback(event) {
  try {
    const payload = JSON.parse(event.object.payload);
    const peerId = event.object.peer_id;
    const userId = payload.userId;
    const user = await getUser(userId);
    const userLink = user ? createUserLink(user) : `ID${userId}`;

    if (payload.action === 'ban') {
      const days = payload.days;
      try {
        // Добавляем в локальный ЧС
        const moderator = await getUser(event.object.user_id);
        const moderatorName = moderator ? `${moderator.first_name} ${moderator.last_name}` : `ID${event.object.user_id}`;
        addToLocalBlacklist(userId, days, `Самолив (${moderatorName})`, event.object.user_id);

        const banEndDate = days === 0 ? 0 : Date.now() + days * 24 * 60 * 60 * 1000;
        const banEndText = formatBanEndDate(banEndDate);
        
        // Редактируем сообщение вместо отправки нового
        const originalMessage = event.object.conversation_message_id;
        
        await callVK('messages.edit', {
          peer_id: peerId,
          conversation_message_id: originalMessage,
          message: `[${formatDateMSK()}] [САМОЛИВ]\n${userLink} покинул беседу\n\n✅ Обработано: добавлен в ЧС до ${banEndText}`,
        });

        await callVK('messages.sendMessageEventAnswer', {
          event_id: event.object.event_id,
          user_id: event.object.user_id,
          peer_id: peerId,
        });
      } catch (error) {
        console.error('[VK Bot] Ошибка бана callback:', error.message);
        await sendMessage(peerId, `Ошибка бана: ${error.message}`);
      }
    } else if (payload.action === 'return') {
      try {
        // Не добавляем в ЧС - просто редактируем сообщение
        const originalMessage = event.object.conversation_message_id;
        
        await callVK('messages.edit', {
          peer_id: peerId,
          conversation_message_id: originalMessage,
          message: `[${formatDateMSK()}] [САМОЛИВ]\n${userLink} покинул беседу\n\n✅ Обработано: НЕ добавлен в ЧС`,
        });
        
        await callVK('messages.sendMessageEventAnswer', {
          event_id: event.object.event_id,
          user_id: event.object.user_id,
          peer_id: peerId,
        });
      } catch (error) {
        console.error('[VK Bot] Ошибка обработки возврата:', error.message);
        await sendMessage(peerId, `Ошибка: ${error.message}`);
      }
    }
  } catch (error) {
    console.error('[VK Bot] Ошибка обработки callback:', error.message);
  }
}

// ============= ОБРАБОТКА СОБЫТИЙ =============

async function handleEvent(event) {
  try {
    if (event.type === 'message_new' && event.object.message) {
      const message = event.object.message;

      // Обработка событий чата
      if (message.action) {
        if (message.action.type === 'chat_invite_user') {
          await handleChatJoin(message);
        } else if (message.action.type === 'chat_kick_user') {
          await handleChatLeave(message);
        }
        return;
      }

      // Проверка на мут - если мут истек, снимаем ограничение
      const muteInfo = isUserMuted(message.peer_id, message.from_id);
      if (muteInfo === null) {
        // Проверяем, был ли у пользователя мут ранее (на случай истечения)
        // Если был - восстанавливаем права
        const key = `${message.peer_id}_${message.from_id}`;
        if (storage.mutes.has(key) === false) {
          // Пользователь не замучен, все в порядке
        }
      }

      // Обработка команд
      const text = message.text?.trim();
      if (!text || !text.startsWith('!')) return;

      const parts = text.split(/\s+/);
      const command = parts[0].slice(1).toLowerCase();

      console.log('[VK Bot] Команда:', command);

      if (commands[command]) {
        const ctx = {
          message,
          userId: message.from_id,
          peerId: message.peer_id,
          args: parts,
          replyMessage: message.reply_message,
        };

        await commands[command](ctx);
      }
    }

    // Обработка callback событий (кнопки)
    if (event.type === 'message_event') {
      await handleCallback(event);
    }
  } catch (error) {
    console.error('[VK Bot] Ошибка обраб��тки события:', error);
  }
}

// ============= LONG POLLING =============

async function startLongPolling() {
  let server = await getLongPollServer();
  let ts = server.ts;

  console.log('[VK Bot] Long Polling за��ущен');
  console.log('[VK Bot] Ожидание событий...\n');

  while (true) {
    try {
      const url = `${server.server}?act=a_check&key=${server.key}&ts=${ts}&wait=25`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.failed) {
        console.log(`[VK Bot] Long Poll failed: ${data.failed}, переподключение...`);
        if (data.failed === 1) {
          ts = data.ts;
        } else {
          server = await getLongPollServer();
          ts = server.ts;
        }
        continue;
      }

      ts = data.ts;

      if (data.updates && data.updates.length > 0) {
        console.log(`[VK Bot] Получено ${data.updates.length} событий`);
        for (const update of data.updates) {
          await handleEvent(update);
        }
      }
    } catch (error) {
      console.error('[VK Bot] Ошибка:', error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));

      try {
        server = await getLongPollServer();
        ts = server.ts;
      } catch (reconnectError) {
        console.error('[VK Bot] Ошибка переподключения:', reconnectError.message);
      }
    }
  }
}

// Обработка завершения
process.on('SIGINT', () => {
  console.log('\n[VK Bot] Остановка...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[VK Bot] Остановка...');
  process.exit(0);
});

// Запу��к
console.log('[VK Bot] Запуск...\n');

// Загружаем локальный ЧС и муты из файлов
loadLocalBlacklist();
loadMutes();

// Запускаем бота
startLongPolling().catch((error) => {
  console.error('[VK Bot] Критическая ошибка:', error);
  process.exit(1);
});
