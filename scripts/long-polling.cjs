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
    blacklistCache: {
      userIds: new Set(), // Set пользователей в ЧС
      lastUpdate: 0, // Время последнего обновления
      ttl: 5 * 60 * 1000, // Время жизни кеша: 5 минут
    },
  };

  // Обновление кеша черного списка
  async function updateBlacklistCache() {
    try {
      const banned = await callVK('groups.getBanned', {
        group_id: VK_GROUP1_ID,
        count: 200,
      });
      
      storage.blacklistCache.userIds.clear();
      
      if (banned.items) {
        for (const item of banned.items) {
          if (item.type === 'profile' && item.profile) {
            storage.blacklistCache.userIds.add(item.profile.id);
          }
        }
      }
      
      storage.blacklistCache.lastUpdate = Date.now();
      console.log('[VK Bot] Кеш ЧС обновлен:', storage.blacklistCache.userIds.size, 'пользователей');
    } catch (error) {
      console.error('[VK Bot] Ошибка обновления кеша ЧС:', error.message);
    }
  }

  // Проверка, находится ли пользователь в ЧС (с кешированием)
  async function isUserInBlacklist(userId) {
    const now = Date.now();
    
    // Обновляем кеш если он устарел
    if (now - storage.blacklistCache.lastUpdate > storage.blacklistCache.ttl) {
      await updateBlacklistCache();
    }
    
    return storage.blacklistCache.userIds.has(userId);
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
  
  async function callVK(method, params = {}, useGroup2 = false) {
  // Всегда используем токен группы (группа должна быть админом в чатах)
  const token = useGroup2 ? VK_GROUP2_TOKEN : VK_GROUP1_TOKEN;

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
    return 'kurier'; // По умолчанию курьер, если есть доступ к эти�� чатам
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

// Функция для распознавания алиасов чатов
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
  
  const greetingText = ctx.replyMessage.text;
  storage.greetings.set(targetPeerId, greetingText);
  
  const chatName = getChatName(targetPeerId);
  await sendMessage(ctx.peerId, `Приветствие установлено для чата "${chatName}"`);
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
  
  try {
    await callVK('messages.pin', {
      peer_id: targetPeerId,
      conversation_message_id: ctx.replyMessage.conversation_message_id,
    });
    
    const chatName = getChatName(targetPeerId);
    await sendMessage(ctx.peerId, `Сообщение закреплено в чате "${chatName}"`);
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
      
      // Обновляем кеш ЧС
      storage.blacklistCache.userIds.add(targetUserId);
      console.log('[VK Bot] Пользователь', targetUserId, 'добавлен в кеш ЧС');
    } catch (error) {
      console.error('[VK Bot] Ошибка добавления в ЧС:', error.message);
    }
  }

  let banText = '';
  if (banDays > 0) {
    banText = banDays === 999 ? '. Занесён в ЧС перманентно' : `. Занесён в ЧС на ${banDays} дней`;
  }
  
  await sendMessage(ctx.peerId, `${userLink} кикнут из всех чатов (удалён из ${removed})${banText}`);

  // Логируем в Руководство
  const initiator = await getUser(ctx.userId);
  if (initiator && CHATS.rukovodstvo > 0) {
    const log = `[${formatDate()}] [КИК]\n${userLink} кикнут ${createUserLink(initiator)}${banText}`;
    await sendMessage(CHATS.rukovodstvo, log); // Уже peer_id
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
// !диагностика - проверка токена и прав в чатах
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

const commands = {
  'пост': cmdPost,
  'приветствие': cmdGreeting,
  'закреп': cmdPin,
  'кик': cmdKick,
  'чат': cmdChatInfo,
  'увед': cmdNotify,
  'диагностика': cmdDiagnostics,
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

  // Проверяем, находится ли пользователь в черном списке (с кешированием)
  const isInBlacklist = await isUserInBlacklist(userId);
  console.log('[VK Bot] Пользователь', userId, 'в ЧС:', isInBlacklist);

  // Если пользователь в ЧС - автоматически кикаем
  if (isInBlacklist) {
    console.log('[VK Bot] Начинаем автокик пользователя', userId);
    try {
      await callVK('messages.removeChatUser', {
        chat_id: getChatId(message.peer_id),
        member_id: userId,
      });
      
      const userLink = createUserLink(user);
      await sendMessage(message.peer_id, `${userLink} автоматически удалён (находится в ЧС)`);
      
      // Логируем в Руководство
      if (CHATS.rukovodstvo && CHATS.rukovodstvo > 0) {
        const log = `[${formatDate()}] [АВТОКИК]\n${userLink} автоматически удалён из беседы (в ЧС)`;
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
    const welcomeText = greeting.replace('{user}', createUserLink(user));
    await sendMessage(message.peer_id, welcomeText);
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
      `[${formatDate()}] [САМОЛИВ]\n${userLink} покинул беседу\n\nЗанести в ЧС?`,
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
        await callVK('groups.ban', {
          group_id: VK_GROUP1_ID,
          owner_id: userId,
          end_date: days === 0 ? 0 : Math.floor(Date.now() / 1000) + days * 86400,
          reason: 0,
          comment: 'Самолив',
        });

        // Обновляем кеш ЧС
        storage.blacklistCache.userIds.add(userId);
        console.log('[VK Bot] Пользователь', userId, 'добавлен в кеш ЧС (callback)');

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
    // Возврат в чаты через API невозможен (groups.addChatUser не работает)
    // Пользователь должен быть приглашен вручную

      await sendMessage(peerId, `${userLink} возвращён во все чаты`);
      await callVK('messages.sendMessageEventAnswer', {
        event_id: event.object.event_id,
        user_id: event.object.user_id,
        peer_id: peerId,
      });

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

// Запуск
console.log('[VK Bot] Запуск...\n');

// Загружаем кеш ЧС при старте
updateBlacklistCache().then(() => {
  console.log('[VK Bot] Кеш ЧС загружен при старте');
  
  startLongPolling().catch((error) => {
    console.error('[VK Bot] Критическая ошибка:', error);
    process.exit(1);
  });
}).catch(error) => {
  console.error('[VK Bot] Ошибка загрузки кеша ЧС:', error.message);
  console.log('[VK Bot] Запуск без предзагрузки кеша...');
}
