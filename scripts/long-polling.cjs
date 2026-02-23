/**
 * VK Long Polling Bot - Standalone версия
 * 
 * Полнофункциональный бот для управления чатами с системой ролей
 * Реализует все команды из VK_BOT_README.md
 * 
 * Команды:
 * !пост - публикация в группу (только РС)
 * !приветствие - установка приветствия (только РС)
 * !закреп - закрепление сообщения (только РС)
 * !кик - удаление пользователя (РС и СС)
 * !инвайт - приглашение с ролью (РС и СС)
 * !увед - массовое уведомление (РС и СС)
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
const VK_USER_TOKEN = process.env.VK_USER_TOKEN; // Токен пользователя для addChatUser/removeChatUser
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
};

console.log('[VK Bot] Проверка конфигурации...');
console.log('[VK Bot] Чаты:', CHATS);

if (!VK_GROUP1_TOKEN || !VK_GROUP1_ID) {
  console.error('[VK Bot] Не установлены VK_GROUP1_TOKEN или VK_GROUP1_ID');
  process.exit(1);
}

if (!VK_USER_TOKEN) {
  console.warn('[VK Bot] ⚠️  VK_USER_TOKEN не установлен!');
  console.warn('[VK Bot] ⚠️  Команды !инвайт и !кик не будут работать.');
  console.warn('[VK Bot] ⚠️  Получите user token на: https://vkhost.github.io/');
  console.warn('[VK Bot] ⚠️  Требуемые права: messages (Доступ к сообщениям)');
  console.warn('[VK Bot] ⚠️  ВАЖНО: Пользователь должен быть администратором во всех чатах!');
} else {
  console.log('[VK Bot] ✓ VK_USER_TOKEN установлен');
}

// ============= VK API =============

// Методы, требующие user token вместо group token
const USER_TOKEN_METHODS = ['messages.addChatUser', 'messages.removeChatUser'];

async function callVK(method, params = {}, useGroup2 = false) {
  // Определяем какой токен использовать
  let token;
  if (USER_TOKEN_METHODS.includes(method)) {
    // Для методов управления чатами нужен user token
    if (!VK_USER_TOKEN) {
      throw new Error('VK_USER_TOKEN не установлен. Эти методы требуют токен пользователя, не группы.');
    }
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

function getChatName(chatId) {
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
  return names[chatId] || `Чат ${chatId}`;
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
    return 'kurier'; // По умолчанию курьер, если есть доступ к этим чатам
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
  const chatId = peerIdToChatId(ctx.peerId);
  if (chatId !== CHATS.rukovodstvo) {
    await sendMessage(ctx.peerId, 'Команда доступна только в чате Руководства');
    return;
  }

  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС');
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

    // Собираем вложения
    if (msg.attachments) {
      for (const att of msg.attachments) {
        if (att.type === 'photo') {
          const photoId = `photo${att.photo.owner_id}_${att.photo.id}`;
          attachments.push(photoId);
        }
      }
    }

    // Публикуем на стену группы 2
    await callVK('wall.post', {
      owner_id: -VK_GROUP2_ID,
      message: text,
      attachments: attachments.join(','),
      from_group: 1,
    }, true);

    await sendMessage(ctx.peerId, 'Пост успешно опубликован в группе');
  } catch (error) {
    await sendMessage(ctx.peerId, `Ошибка публикации: ${error.message}`);
  }
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

  const greetingText = ctx.replyMessage.text;
  storage.greetings.set(ctx.peerId, greetingText);
  await sendMessage(ctx.peerId, 'Приветствие установлено');
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

  try {
    await callVK('messages.pin', {
      peer_id: ctx.peerId,
      conversation_message_id: ctx.replyMessage.conversation_message_id,
    });
    await sendMessage(ctx.peerId, 'Сообщение закреплено');
  } catch (error) {
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
    await sendMessage(ctx.peerId, 'Использование: !кик [ссылка] [дни_бана] или !кик [ссылка] спонсор');
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
      await sendMessage(ctx.peerId, `Ошибка удаления: ${error.message}`);
    }
    return;
  }

  // Обычный кик из всех чатов
  const banDays = parseInt(ctx.args[2]) || 0;

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

  // Добавляем в ЧС если указаны дни
  if (banDays > 0) {
    try {
      await callVK('groups.ban', {
        group_id: VK_GROUP1_ID,
        owner_id: targetUserId,
        end_date: banDays === 999 ? 0 : Math.floor(Date.now() / 1000) + banDays * 86400,
        reason: 0,
        comment: 'Кик через бота',
      });
    } catch (error) {
      console.error('[VK Bot] Ошибка добавления в ЧС:', error.message);
    }
  }

  const banText = banDays > 0 ? `. Занесён в ЧС на ${banDays === 999 ? 'перманентно' : banDays + ' дней'}` : '';
  await sendMessage(ctx.peerId, `${userLink} кикнут из всех чатов (удалён из ${removed})${banText}`);

  // Логируем в Руководство
  const initiator = await getUser(ctx.userId);
  if (initiator) {
    const log = `[${formatDate()}] [КИК]\n${userLink} к��кнут ${createUserLink(initiator)}${banText}`;
    await sendMessage(chatIdToPeerId(CHATS.rukovodstvo), log);
  }
}

// !инвайт - приглашение с ролью
async function cmdInvite(ctx) {
  const hasPerm = await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']);
  console.log(`[v0] Инвайт: пользователь ${ctx.userId}, чат ${peerIdToChatId(ctx.peerId)}, права: ${hasPerm}`);

  if (!hasPerm) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
    return;
  }

  if (ctx.args.length < 3) {
    await sendMessage(ctx.peerId, 'Использование: !инвайт [ссылка] [роль]\nРоли: стажёр, курьер, сс, рс, спонсор');
    return;
  }

  const targetUserId = extractUserId(ctx.args[1]);
  if (!targetUserId) {
    await sendMessage(ctx.peerId, 'Не удалось извлечь ID пользователя');
    return;
  }

  const roleInput = ctx.args[2].toLowerCase();
  let role = null;
  let isSponsor = false;

  if (roleInput === 'стажёр' || roleInput === 'стажер') role = 'stazher';
  else if (roleInput === 'курьер') role = 'kurier';
  else if (roleInput === 'сс') role = 'ss';
  else if (roleInput === 'рс') role = 'rs';
  else if (roleInput === 'спонсор') isSponsor = true;

  if (!role && !isSponsor) {
    await sendMessage(ctx.peerId, 'Неверная роль. Доступны: стажёр, курьер, сс, рс, спонсор');
    return;
  }

  const targetUser = await getUser(targetUserId);
  if (!targetUser) {
    await sendMessage(ctx.peerId, 'Пользователь не найден');
    return;
  }

  const userLink = createUserLink(targetUser);

  // Приглашаем в чаты согласно роли
  if (isSponsor) {
    try {
      await callVK('messages.addChatUser', {
        chat_id: getChatId(CHATS.sponsor),
        user_id: targetUserId,
      });
      await sendMessage(ctx.peerId, `${userLink} приглашён в Спонсорскую беседу`);
    } catch (error) {
      const errorMsg = error.message.includes('VK_USER_TOKEN')
        ? 'Для приглашения требуется VK_USER_TOKEN в .env файле'
        : error.message.includes('Access denied')
          ? 'Нет прав администратора в спонсорской беседе. Пользователь с VK_USER_TOKEN должен быть администратором!'
          : `Ошибка приглашения: ${error.message}`;
      await sendMessage(ctx.peerId, errorMsg);
    }
  } else {
    const chatNames = ROLE_CHATS[role];
    let added = 0;
    const errors = [];

    for (const chatName of chatNames) {
      const chatPeerId = CHATS[chatName];
      if (!chatPeerId || chatPeerId === 0) continue;

      try {
        const chatId = getChatId(chatPeerId);
        await callVK('messages.addChatUser', {
          chat_id: chatId,
          user_id: targetUserId,
        });
        added++;
      } catch (error) {
        console.error(`[VK Bot] Не удалось добавить в ${chatName}:`, error.message);
        if (error.message.includes('Access denied')) {
          errors.push(`${chatName}: нет прав администратора`);
        } else {
          errors.push(`${chatName}: ${error.message}`);
        }
      }
    }

    let resultMsg = `${userLink} приглашён с ролью ${roleInput} (добавлен в ${added}/${chatNames.length} чатов)`;
    if (errors.length > 0 && added === 0) {
      resultMsg += `\n\n⚠️ Ошибки:\n${errors.join('\n')}\n\n`;
      resultMsg += `🔧 Решение проблемы:\n`;
      resultMsg += `1. Откройте vkhost.github.io\n`;
      resultMsg += `2. Авторизуйтесь под своим аккаунтом (id700970214)\n`;
      resultMsg += `3. Выберите API Version: 5.131\n`;
      resultMsg += `4. Отметьте галочки: Messages, Offline, Groups\n`;
      resultMsg += `5. Получите токен и замените VK_USER_TOKEN в .env\n`;
      resultMsg += `6. Перезапустите бота\n`;
      resultMsg += `\nВыполните команду !диагностика для проверки`;
    }
    await sendMessage(ctx.peerId, resultMsg);

    // Логируем в Руководство только если успешно добавлен хотя бы в один чат
    if (added > 0) {
      const initiator = await getUser(ctx.userId);
      if (initiator && CHATS.rukovodstvo && CHATS.rukovodstvo > 0) {
        const log = `[${formatDate()}] [ИНВАЙТ]\n${userLink} приглашён ${createUserLink(initiator)} с ролью ${roleInput}`;
        await sendMessage(chatIdToPeerId(CHATS.rukovodstvo), log);
      }
    }
  }
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
// !диагностика - проверка токена и прав в чатах
async function cmdDiagnostics(ctx) {
  if (!await hasPermission(ctx.userId, ctx.peerId, ['rs'])) {
    await sendMessage(ctx.peerId, 'Недостаточно прав. Доступно только для РС.');
    return;
  }

  let report = '🔍 Диагностика токена и чатов:\n\n';
  let tokenOwnerUserId = null;

  // Проверяем user token
  if (!VK_USER_TOKEN) {
    report += '❌ VK_USER_TOKEN не установлен\n\n';
  } else {
    try {
      // Проверяем USER токен напрямую
      const url = 'https://api.vk.com/method/users.get';
      const body = new URLSearchParams({
        access_token: VK_USER_TOKEN,
        v: VK_API_VERSION,
      });
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const data = await response.json();
      
      if (data.error) {
        report += `❌ VK_USER_TOKEN невалидный: ${data.error.error_msg}\n\n`;
      } else if (data.response && data.response[0]) {
        const user = data.response[0];
        tokenOwnerUserId = user.id;
        report += `✓ User Token валидный (id${user.id} - ${user.first_name} ${user.last_name})\n`;
        
        // Пробуем добавить самого себя в первый чат для проверки scope
        const firstChatPeerId = Object.values(CHATS).find(id => id > 0);
        if (firstChatPeerId) {
          try {
            const testChatId = getChatId(firstChatPeerId);
            await callVK('messages.addChatUser', {
              chat_id: testChatId,
              user_id: tokenOwnerUserId,
            });
            report += `✓ Токен может добавлять пользователей в чаты\n\n`;
          } catch (testError) {
            report += `❌ Токен НЕ может добавлять пользователей: ${testError.message}\n`;
            if (testError.message.includes('Access denied')) {
              report += `⚠️ Возможные причины:\n`;
              report += `  1. Токен не имеет scope "messages" или "manage"\n`;
              report += `  2. Получите новый токен на vkhost.github.io с правами "messages"\n`;
              report += `  3. Убедитесь что вы копируете ПОЛНЫЙ токен\n\n`;
            }
          }
        }
      } else {
        report += `❌ VK_USER_TOKEN вернул неожиданный ответ\n\n`;
      }
    } catch (error) {
      report += `❌ Ошибка проверки User Token: ${error.message}\n\n`;
    }
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
        
        // Проверяем права администратора
        let isAdmin = false;
        if (tokenOwnerUserId) {
          try {
            const members = await callVK('messages.getConversationMembers', {
              peer_id: chatPeerId,
            });
            const member = members.items.find(m => m.member_id === tokenOwnerUserId);
            isAdmin = member && (member.is_admin || member.is_owner);
          } catch (e) {
            // Не можем проверить права
          }
        }
        
        const adminStatus = isAdmin ? '✓ админ' : '❌ НЕ админ';
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

const commands = {
  'пост': cmdPost,
  'приветствие': cmdGreeting,
  'закреп': cmdPin,
  'кик': cmdKick,
  'инвайт': cmdInvite,
  'увед': cmdNotify,
  'диагностика': cmdDiagnostics,
};

// ============= СОБЫТИЯ =============

// Приветствие новых участников
async function handleChatJoin(message) {
  const greeting = storage.greetings.get(message.peer_id);
  if (!greeting) return;

  const userId = message.action.member_id;
  const user = await getUser(userId);
  if (!user) return;

  const welcomeText = greeting.replace('{user}', createUserLink(user));
  await sendMessage(message.peer_id, welcomeText);
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
        { action: { type: 'callback', label: 'Да (30 дней)', payload: JSON.stringify({ action: 'ban', userId, days: 30 }) }, color: 'negative' },
        { action: { type: 'callback', label: 'Нет', payload: JSON.stringify({ action: 'return', userId }) }, color: 'positive' },
      ],
      [
        { action: { type: 'callback', label: 'Другое кол-во дней', payload: JSON.stringify({ action: 'ban_options', userId }) }, color: 'secondary' },
      ],
    ],
  };

  await sendMessage(
    chatIdToPeerId(CHATS.rukovodstvo),
    `[${formatDate()}] [САМОЛИВ]\n${userLink} покинул беседу\n\nЗанести в ЧС?`,
    { keyboard: JSON.stringify(keyboard) }
  );
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
        await callVK('groups.ban', {
          group_id: VK_GROUP1_ID,
          owner_id: userId,
          end_date: days === 0 ? 0 : Math.floor(Date.now() / 1000) + days * 86400,
          reason: 0,
          comment: 'Самолив',
        });

        const banText = days === 0 ? 'перманентно' : `на ${days} дней`;
        await sendMessage(peerId, `${userLink} занесён в ЧС ${banText}`);

        await callVK('messages.sendMessageEventAnswer', {
          event_id: event.object.event_id,
          user_id: event.object.user_id,
          peer_id: peerId,
        });
      } catch (error) {
        await sendMessage(peerId, `Ошибка бана: ${error.message}`);
      }
    } else if (payload.action === 'return') {
      const role = await getUserRole(userId);
      if (role) {
        const chatNames = ROLE_CHATS[role];
        for (const chatName of chatNames) {
          const chatPeerId = CHATS[chatName];
          if (!chatPeerId) continue;
          try {
            await callVK('messages.addChatUser', {
              chat_id: getChatId(chatPeerId),
              user_id: userId,
            });
          } catch (error) {
            console.error(`[VK Bot] Ошибка воз��рата в ${chatName}:`, error.message);
          }
        }
      }

      await sendMessage(peerId, `${userLink} возвращён во все чаты`);
      await callVK('messages.sendMessageEventAnswer', {
        event_id: event.object.event_id,
        user_id: event.object.user_id,
        peer_id: peerId,
      });
    } else if (payload.action === 'ban_options') {
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
            { action: { type: 'callback', label: 'Перманентно', payload: JSON.stringify({ action: 'ban', userId, days: 0 }) }, color: 'negative' },
            { action: { type: 'callback', label: 'Отмена', payload: JSON.stringify({ action: 'cancel' }) }, color: 'secondary' },
          ],
        ],
      };

      await callVK('messages.sendMessageEventAnswer', {
        event_id: event.object.event_id,
        user_id: event.object.user_id,
        peer_id: peerId,
      });

      await sendMessage(peerId, `Выберите срок бана для ${userLink}:`, { keyboard: JSON.stringify(keyboard) });
    }
  } catch (error) {
    console.error('[VK Bot] Ошибка обработки callback:', error);
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
    console.error('[VK Bot] Ошибка обработки события:', error);
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

// Запуск
console.log('[VK Bot] Запуск...\n');
startLongPolling().catch((error) => {
  console.error('[VK Bot] Критическая ошибка:', error);
  process.exit(1);
});
