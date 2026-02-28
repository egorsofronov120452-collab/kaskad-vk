import { CHATS, type Role } from './config';
import { VK_GROUP1_ID, VK_GROUP2_ID } from './config';
import { callVK, sendMessage, getUser, reuploadPhotoToGroup } from './vk-api';
import { hasPermission, getUserRole } from './roles';
import {
  extractUserId,
  createUserLink,
  getChatId,
  getChatName,
  getChatIdByAlias,
  formatBanEndDate,
  formatDateMSK,
  parseMuteDuration,
  collectAttachments,
  peerIdToChatId,
} from './utils';
import {
  addToBlacklist,
  removeFromBlacklist,
  isUserInBlacklist,
  getAllBlacklist,
  addMute,
  removeMute,
  setGreeting,
  // v2
  upsertUser,
  getEmployee,
  registerEmployee,
  setUserNickname,
  setUserBankAccount,
  getEmployeeCars,
  getAllCars,
  addEmployeeCar,
  getCategories,
  getCategoryById,
  getProductsByCategory,
  createCategory,
  createProduct,
  createPromoCode,
  openActivitySession,
  closeActivitySession,
  getCurrentOnlineList,
  getOnlineStatsForUser,
  getOnlineRankThisWeek,
} from './db';

export interface BotCtx {
  message: any;
  userId: number;
  peerId: number;
  args: string[];
  replyMessage: any;
}

// ============= !пост =============
export async function cmdPost(ctx: BotCtx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
    return;
  }

  // Принимаем команду, если есть reply ИЛИ прикреплённые фото к самому сообщению
  const cmdAttachments: any[] = ctx.message.attachments ?? [];
  if (!ctx.replyMessage && cmdAttachments.length === 0) {
    await sendMessage(
      ctx.peerId,
      'Ответьте на сообщение или прикрепите фото к команде !пост [текст]',
    );
    return;
  }

  try {
    // Текст: из reply или из аргументов после команды
    const text = ctx.replyMessage
      ? ctx.replyMessage.text || ''
      : ctx.args.slice(1).join(' ');

    // Вложения из reply-сообщения
    const replyAtts: any[] = ctx.replyMessage?.attachments ?? [];
    const rawAtts: string[] = collectAttachments(replyAtts);

    const attachments: string[] = [];

    // Обрабатываем вложения из reply
    for (const att of replyAtts) {
      if (att.type === 'photo' && att.photo) {
        const id = await reuploadPhotoToGroup(att.photo, VK_GROUP2_ID, true);
        if (id) attachments.push(id);
      } else {
        const plain = rawAtts.find(a => a.startsWith(att.type));
        if (plain) attachments.push(plain);
      }
    }

    // Обрабатываем фото, прикреплённые к самому сообщению с командой
    for (const att of cmdAttachments) {
      if (att.type === 'photo' && att.photo) {
        const id = await reuploadPhotoToGroup(att.photo, VK_GROUP2_ID, true);
        if (id) attachments.push(id);
      }
    }

    const postParams: Record<string, any> = {
      owner_id: `-${VK_GROUP2_ID}`,
      message: text,
      from_group: 1,
    };
    if (attachments.length) postParams.attachments = attachments.join(',');

    await callVK('wall.post', postParams, true);
    await sendMessage(ctx.peerId, 'Пост успешно опубликован в группе');
  } catch (err: any) {
    await sendMessage(ctx.peerId, `Ошибка публикации: ${err.message}`);
  }
}

// ============= !приказ =============
export async function cmdPrikaz(ctx: BotCtx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
    return;
  }

  // Принимаем команду, если есть reply ИЛИ прикреплённые фото к самому сообщению
  const cmdAttachments: any[] = ctx.message.attachments ?? [];
  if (!ctx.replyMessage && cmdAttachments.length === 0) {
    await sendMessage(
      ctx.peerId,
      'Ответьте на сообщение или прикрепите фото к команде !приказ [текст]',
    );
    return;
  }

  try {
    // Текст: из reply или из аргументов после команды
    const text = ctx.replyMessage
      ? ctx.replyMessage.text || ''
      : ctx.args.slice(1).join(' ');

    // Вложения из reply-сообщения
    const replyAtts: any[] = ctx.replyMessage?.attachments ?? [];
    const attachments: string[] = [];

    for (const att of replyAtts) {
      if (att.type === 'photo' && att.photo) {
        const id = await reuploadPhotoToGroup(att.photo, VK_GROUP1_ID, false);
        if (id) attachments.push(id);
      } else {
        const ids = collectAttachments([att]);
        attachments.push(...ids);
      }
    }

    // Обрабатываем фото, прикреплённые к самому сообщению с командой
    for (const att of cmdAttachments) {
      if (att.type === 'photo' && att.photo) {
        const id = await reuploadPhotoToGroup(att.photo, VK_GROUP1_ID, false);
        if (id) attachments.push(id);
      }
    }

    const postParams: Record<string, any> = {
      owner_id: `-${VK_GROUP1_ID}`,
      message: text,
      from_group: 1,
    };
    if (attachments.length) postParams.attachments = attachments.join(',');

    await callVK('wall.post', postParams, false);
    await sendMessage(ctx.peerId, 'Приказ успешно опубликован в доску объявлений группы');
  } catch (err: any) {
    await sendMessage(ctx.peerId, `Ошибка публикации: ${err.message}`);
  }
}

// ============= !приветствие =============
export async function cmdGreeting(ctx: BotCtx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС');
    return;
  }
  if (!ctx.replyMessage) {
    await sendMessage(ctx.peerId, 'Ответьте на сообщение с текстом приветствия');
    return;
  }

  let targetPeerId = ctx.peerId;
  if (ctx.args.length >= 2) {
    const alias = ctx.args[1];
    const peerId = getChatIdByAlias(alias);
    if (peerId) {
      targetPeerId = peerId;
    } else {
      await sendMessage(ctx.peerId, 'Неизвестный чат. Доступные: рс, сс, уц, до, дисп, флуд, жа, спонсор');
      return;
    }
  }

  const greetingText = ctx.replyMessage.text || '';
  const attachments = collectAttachments(ctx.replyMessage.attachments ?? []);

  await setGreeting(targetPeerId, greetingText, attachments);

  const chatName = getChatName(targetPeerId);
  const attText = attachments.length ? ` (с ${attachments.length} вложениями)` : '';
  await sendMessage(ctx.peerId, `Приветствие установлено для чата "${chatName}"${attText}`);
}

// ============= !закреп =============
export async function cmdPin(ctx: BotCtx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС');
    return;
  }
  if (!ctx.replyMessage) {
    await sendMessage(ctx.peerId, 'Ответьте на сообщение, которое нужно закрепить');
    return;
  }

  let targetPeerId = ctx.peerId;
  let targetAlias: string | null = null;

  if (ctx.args.length >= 2) {
    const alias = ctx.args[1];
    const peerId = getChatIdByAlias(alias);
    if (peerId) {
      targetPeerId = peerId;
      targetAlias = alias;
    } else {
      await sendMessage(ctx.peerId, 'Неизвестный чат. Доступные: рс, сс, уц, до, дисп, флуд, жа, спонсор');
      return;
    }
  }

  try {
    const msg = ctx.replyMessage;
    const text = msg.text || '';
    const attachments = collectAttachments(msg.attachments ?? []);

    const conversationInfo = await callVK('messages.getConversationsById', {
      peer_ids: targetPeerId,
    });

    let pinnedCmid: number | null = null;
    if (conversationInfo.items?.[0]) {
      const conv = conversationInfo.items[0];
      const pinned =
        conv.chat_settings?.pinned_message ?? conv.pinned_message;
      if (pinned) {
        pinnedCmid =
          pinned.conversatiion_message_id ??
          pinned.conversation_message_id ??
          pinned.cmid ??
          null;
      }
    }

    if (pinnedCmid) {
      const editParams: Record<string, any> = {
        peer_id: targetPeerId,
        conversation_message_id: pinnedCmid,
        message: text,
      };
      if (attachments.length) editParams.attachment = attachments.join(',');
      await callVK('messages.edit', editParams);

      const chatName = getChatName(targetPeerId);
      await sendMessage(
        ctx.peerId,
        targetAlias
          ? `Закреплённое сообщение обновлено в чате "${chatName}"`
          : 'Закреплённое сообщение обновлено',
      );
    } else {
      const chatName = getChatName(targetPeerId);
      await sendMessage(
        ctx.peerId,
        `Ошибка: в чате "${chatName}" нет закреплённого сообщения.\n` +
          'Сначала закрепите сообщение вручную, затем используйте !закреп для его редактирования.',
      );
    }
  } catch (err: any) {
    await sendMessage(ctx.peerId, `Ошибка закрепления: ${err.message}`);
  }
}

// ============= !кик =============
export async function cmdKick(ctx: BotCtx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
    return;
  }
  if (ctx.args.length < 2) {
    await sendMessage(
      ctx.peerId,
      'Использование:\n!кик [ссылка] [дни_бана]\n!кик [ссылка] perm - перманентный бан\n!кик [ссылка] спонсор - кик только из спонсорской беседы',
    );
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
  const isSponsorKick = ctx.args[2] === 'спонсор';

  if (isSponsorKick) {
    try {
      await callVK('messages.removeChatUser', {
        chat_id: getChatId(CHATS.sponsor),
        member_id: targetUserId,
      });
      await sendMessage(ctx.peerId, `${userLink} удалён из Спонсорской беседы`);
    } catch (err: any) {
      const msg = err.message.includes('Access denied')
        ? 'Группа не является администратором спонсорской беседы.'
        : `Ошибка удаления: ${err.message}`;
      await sendMessage(ctx.peerId, msg);
    }
    return;
  }

  const banArg = ctx.args[2]?.toLowerCase();
  let banDays = 0;
  if (banArg === 'perm' || banArg === 'перманент') {
    banDays = 999;
  } else {
    banDays = parseInt(ctx.args[2]) || 0;
  }

  const allChats = Object.values(CHATS).filter(id => id > 0 && id !== CHATS.sponsor);
  let removed = 0;
  for (const chatPeerId of allChats) {
    try {
      await callVK('messages.removeChatUser', {
        chat_id: getChatId(chatPeerId),
        member_id: targetUserId,
      });
      removed++;
    } catch {
      // ignore
    }
  }

  let banText = '';
  if (banDays > 0) {
    const finalDays = banDays === 999 ? 0 : banDays;
    const initiator = await getUser(ctx.userId);
    const initiatorName = initiator
      ? `${initiator.first_name} ${initiator.last_name}`
      : `ID${ctx.userId}`;
    await addToBlacklist(targetUserId, finalDays, `Кик через команду !кик (${initiatorName})`, ctx.userId);
    const banEndDate = finalDays === 0 ? 0 : Date.now() + finalDays * 24 * 60 * 60 * 1000;
    banText = `. Занесён в ЧС до ${formatBanEndDate(banEndDate)}`;
  }

  await sendMessage(ctx.peerId, `${userLink} кикнут из всех чатов (удалён из ${removed})${banText}`);

  if (ctx.peerId !== CHATS.rukovodstvo && CHATS.rukovodstvo > 0) {
    const initiator = await getUser(ctx.userId);
    if (initiator) {
      const log = `[${formatDateMSK()}] [КИК]\n${userLink} кикнут ${createUserLink(initiator)}${banText}`;
      await sendMessage(CHATS.rukovodstvo, log);
    }
  }
}

// ============= !чат =============
export async function cmdChatInfo(ctx: BotCtx) {
  const chatId = peerIdToChatId(ctx.peerId);
  const chatName = getChatName(ctx.peerId);
  await sendMessage(
    ctx.peerId,
    `Информация о чате:\nНазвание: ${chatName}\nChat ID: ${chatId}\nPeer ID: ${ctx.peerId}`,
  );
}

// ============= !увед =============
async function notifyMembers(peerId: number, userIds: number[]): Promise<number> {
  if (userIds.length === 0) return 0;

  const chunks: number[][] = [];
  for (let i = 0; i < userIds.length; i += 10) {
    chunks.push(userIds.slice(i, i + 10));
  }

  // Шаг 1: отправляем первый чанк — получаем cmid единственного сообщения
  const firstMentions = chunks[0].map(id => `[id${id}|\u200b]`).join(' ');
  let cmid: number | undefined;
  try {
    const raw = await callVK('messages.send', {
      peer_id: peerId,
      message: firstMentions,
      random_id: Math.floor(Math.random() * 1_000_000_000),
    });
    const id = typeof raw === 'object' ? (raw.conversation_message_id ?? raw) : raw;
    cmid = typeof id === 'number' ? id : undefined;
  } catch (err: any) {
    console.error('[Bot] Ошибка отправки первого уведомления:', err.message);
    return 0;
  }

  if (cmid === undefined) return userIds.length;

  // Шаг 2: редактируем то же самое сообщение для каждого следующего чанка
  for (let i = 1; i < chunks.length; i++) {
    const mentions = chunks[i].map(id => `[id${id}|\u200b]`).join(' ');
    try {
      await callVK('messages.edit', {
        peer_id: peerId,
        conversation_message_id: cmid,
        message: mentions,
      });
    } catch (err: any) {
      console.error('[Bot] Ошибка редактирования уведомления:', err.message);
    }
  }

  // Шаг 3: финальное редактирование — итоговый текст
  try {
    await callVK('messages.edit', {
      peer_id: peerId,
      conversation_message_id: cmid,
      message: `Отправлено уведомление ${userIds.length} участникам`,
    });
  } catch (err: any) {
    console.error('[Bot] Ошибка финального редактирования:', err.message);
  }

  return userIds.length;
}

export async function cmdNotify(ctx: BotCtx) {
  if (ctx.peerId === CHATS.rukovodstvo) return;

  const senderRole = await getUserRole(ctx.userId);

  if (ctx.peerId === CHATS.ss) {
    if (senderRole !== 'rs') return;
    try {
      const members = await callVK('messages.getConversationMembers', { peer_id: ctx.peerId });
      const rsMembers = await callVK('messages.getConversationMembers', { peer_id: CHATS.rukovodstvo });
      const rsIds = new Set((rsMembers.items as any[]).map(m => m.member_id));
      const targetIds = (members.items as any[])
        .filter(m => m.member_id > 0 && !rsIds.has(m.member_id))
        .map(m => m.member_id);
      await notifyMembers(ctx.peerId, targetIds);
    } catch (err: any) {
      await sendMessage(ctx.peerId, `Ошибка уведомления: ${err.message}`);
    }
    return;
  }

  if (senderRole !== 'rs' && senderRole !== 'ss') return;

  try {
    const members = await callVK('messages.getConversationMembers', { peer_id: ctx.peerId });
    const rsM = await callVK('messages.getConversationMembers', { peer_id: CHATS.rukovodstvo });
    const ssM = await callVK('messages.getConversationMembers', { peer_id: CHATS.ss });
    const privileged = new Set([
      ...(rsM.items as any[]).map(m => m.member_id),
      ...(ssM.items as any[]).map(m => m.member_id),
    ]);
    const targetIds = (members.items as any[])
      .filter(m => m.member_id > 0 && !privileged.has(m.member_id))
      .map(m => m.member_id);
    await notifyMembers(ctx.peerId, targetIds);
  } catch (err: any) {
    await sendMessage(ctx.peerId, `Ошибка уведомления: ${err.message}`);
  }
}

// ============= !диагностика =============
export async function cmdDiagnostics(ctx: BotCtx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs']))) {
    await sendMessage(ctx.peerId, 'Недостаточно прав. Доступно только для РС.');
    return;
  }

  let report = 'Диагностика управления чатами:\n\n';
  let groupId: number | null = null;

  report += 'Управление через GROUP TOKEN\n';
  try {
    const groups = await callVK('groups.getById', {});
    if (groups?.[0]) {
      groupId = -groups[0].id;
      report += `Группа: ${groups[0].name} (ID: ${groupId})\n\n`;
    }
  } catch (err: any) {
    report += `Ошибка получ��ния группы: ${err.message}\n\n`;
  }

  report += 'Проверка чатов:\n';
  for (const [chatName, chatPeerId] of Object.entries(CHATS)) {
    if (!chatPeerId) {
      report += `- ${chatName}: не настроен\n`;
      continue;
    }
    try {
      const chatInfo = await callVK('messages.getConversationsById', { peer_ids: chatPeerId });
      if (chatInfo.items?.[0]) {
        const settings = chatInfo.items[0].chat_settings;
        let isAdmin = false;
        if (groupId) {
          try {
            const mems = await callVK('messages.getConversationMembers', { peer_id: chatPeerId });
            const mem = (mems.items as any[]).find(m => m.member_id === groupId);
            isAdmin = !!(mem && (mem.is_admin || mem.is_owner));
          } catch { /* skip */ }
        }
        const adminStatus = isAdmin ? 'группа админ' : 'группа НЕ админ';
        report += `- ${chatName}: доступ OK, ${adminStatus} (участников: ${settings?.members_count ?? '?'})\n`;
      } else {
        report += `- ${chatName}: информация недоступна\n`;
      }
    } catch (err: any) {
      report += `- ${chatName}: ошибка - ${err.message}\n`;
    }
  }

  await sendMessage(ctx.peerId, report);
}

// ============= !чс =============
export async function cmdBlacklist(ctx: BotCtx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
    return;
  }

  const sub = ctx.args[1]?.toLowerCase();

  if (sub === 'список' || !sub) {
    const list = await getAllBlacklist();
    if (!list.length) {
      await sendMessage(ctx.peerId, 'Локальный ЧС пуст');
      return;
    }
    let msg = `Локальный ЧС (${list.length} пользователей):\n\n`;
    let i = 1;
    for (const entry of list) {
      const user = await getUser(entry.userId);
      const userLink = user ? createUserLink(user) : `[id${entry.userId}|ID${entry.userId}]`;
      let bannedByText = 'Неизвестно';
      if (entry.bannedBy) {
        const bBy = await getUser(entry.bannedBy);
        bannedByText = bBy ? createUserLink(bBy) : `ID${entry.bannedBy}`;
      }
      msg += `${i}. ${userLink}\n`;
      msg += `   До: ${formatBanEndDate(entry.endDate)}\n`;
      msg += `   Забанен: ${formatDateMSK(entry.bannedAt)} МСК\n`;
      msg += `   Кем: ${bannedByText}\n`;
      msg += `   Причина: ${entry.reason}\n\n`;
      i++;
    }
    await sendMessage(ctx.peerId, msg);
    return;
  }

  if (sub === 'разбан') {
    if (ctx.args.length < 3) {
      await sendMessage(ctx.peerId, 'Использование: !чс разбан [ссылка]');
      return;
    }
    const targetId = extractUserId(ctx.args[2]);
    if (!targetId) {
      await sendMessage(ctx.peerId, 'Не удалось извлечь ID пользователя');
      return;
    }
    const removed = await removeFromBlacklist(targetId);
    if (removed) {
      const user = await getUser(targetId);
      const name = user ? createUserLink(user) : `ID${targetId}`;
      await sendMessage(ctx.peerId, `${name} удалён из локального ЧС`);
    } else {
      await sendMessage(ctx.peerId, `Пользователь ID${targetId} не найден в локальном ЧС`);
    }
    return;
  }

  if (sub === 'проверка') {
    if (ctx.args.length < 3) {
      await sendMessage(ctx.peerId, 'Использование: !чс проверка [ссылка]');
      return;
    }
    const targetId = extractUserId(ctx.args[2]);
    if (!targetId) {
      await sendMessage(ctx.peerId, 'Не удалось извлечь ID пользователя');
      return;
    }
    const ban = await isUserInBlacklist(targetId);
    const user = await getUser(targetId);
    const name = user ? createUserLink(user) : `[id${targetId}|ID${targetId}]`;
    if (ban) {
      let bannedByText = 'Неизвестно';
      if (ban.bannedBy) {
        const bBy = await getUser(ban.bannedBy);
        bannedByText = bBy ? createUserLink(bBy) : `ID${ban.bannedBy}`;
      }
      await sendMessage(
        ctx.peerId,
        `${name} в локальном ЧС:\n\nДо: ${formatBanEndDate(ban.endDate)}\nЗабанен: ${formatDateMSK(ban.bannedAt)} МСК\nКем: ${bannedByText}\nПричина: ${ban.reason}`,
      );
    } else {
      await sendMessage(ctx.peerId, `${name} НЕ в локальном ЧС`);
    }
    return;
  }

  await sendMessage(
    ctx.peerId,
    'Использование:\n!чс список\n!чс разбан [ссылка]\n!чс проверка [ссылка]',
  );
}

// ============= !мут =============
export async function cmdMute(ctx: BotCtx) {
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

  let targetUserId: number | null = null;
  if (ctx.replyMessage) {
    targetUserId = ctx.replyMessage.from_id;
  } else if (ctx.args.length >= 2) {
    targetUserId = extractUserId(ctx.args[1]);
  }

  if (!targetUserId) {
    await sendMessage(ctx.peerId, 'Использование: !мут [ссылка] [время] [причина]\nИли ответьте на сообщение: !мут [время] [причина]');
    return;
  }

  let duration: number | null = null;
  let reason = 'Нарушение правил';

  if (ctx.replyMessage) {
    if (ctx.args.length >= 2) {
      duration = parseMuteDuration(ctx.args.slice(1, 3).join(' '));
      if (ctx.args.length >= 4) reason = ctx.args.slice(3).join(' ');
      else if (ctx.args.length === 3 && !ctx.args[2].match(/\d/)) reason = ctx.args[2];
    }
  } else {
    if (ctx.args.length >= 3) {
      duration = parseMuteDuration(ctx.args.slice(2, 4).join(' '));
      if (ctx.args.length >= 5) reason = ctx.args.slice(4).join(' ');
      else if (ctx.args.length === 4 && !ctx.args[3].match(/\d/)) reason = ctx.args[3];
    }
  }

  if (!duration || duration <= 0) {
    await sendMessage(ctx.peerId, 'Некорректное время мута. Примеры: "1 час", "30 минут", "2 дня"');
    return;
  }

  try {
    await addMute(targetUserId, duration, reason, ctx.userId);

    const user = await getUser(targetUserId);
    const userLink = user ? createUserLink(user) : `[id${targetUserId}|ID${targetUserId}]`;
    const endDate = Date.now() + duration * 60 * 1000;

    await sendMessage(
      ctx.peerId,
      `${userLink} замучен до ${formatBanEndDate(endDate)}\nПричина: ${reason}\n\nМут глобальный. Все сообщения пользователя будут автоматически удаляться.`,
    );

    if (ctx.peerId !== CHATS.rukovodstvo && CHATS.rukovodstvo > 0) {
      const initiator = await getUser(ctx.userId);
      if (initiator) {
        const chatName = getChatName(ctx.peerId);
        const log = `[${formatDateMSK()}] [МУТ]\n${userLink} замучен в чате "${chatName}" до ${formatBanEndDate(endDate)}\nМодератор: ${createUserLink(initiator)}\nПричина: ${reason}`;
        await sendMessage(CHATS.rukovodstvo, log);
      }
    }
  } catch (err: any) {
    await sendMessage(ctx.peerId, `Ошибка мута: ${err.message}`);
  }
}

// ============= !размут =============
export async function cmdUnmute(ctx: BotCtx) {
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

  let targetUserId: number | null = null;
  if (ctx.replyMessage) {
    targetUserId = ctx.replyMessage.from_id;
  } else if (ctx.args.length >= 2) {
    targetUserId = extractUserId(ctx.args[1]);
  }

  if (!targetUserId) {
    await sendMessage(ctx.peerId, 'Использование: !размут [ссылка]\nИли ответьте на сообщение пользователя');
    return;
  }

  const wasRemoved = await removeMute(targetUserId);
  const user = await getUser(targetUserId);
  const userLink = user ? createUserLink(user) : `[id${targetUserId}|ID${targetUserId}]`;

  await sendMessage(
    ctx.peerId,
    wasRemoved
      ? `С ${userLink} снят мут во всех чатах`
      : `${userLink} не был замучен`,
  );
}

// ============= !онлайн / !афк / !вышел =============
// Только в чате Журнала Активности
async function requireZhurnal(ctx: BotCtx): Promise<boolean> {
  if (ctx.peerId !== CHATS.zhurnal) {
    await sendMessage(ctx.peerId, 'Команды активности доступны только в Журнале Активности');
    return false;
  }
  return true;
}

function buildOnlineListText(list: any[], changedNickname: string, newStatus: string, activityText: string): string {
  const header = `${changedNickname} ${newStatus === 'online' ? 'в сети' : newStatus === 'afk' ? 'отошёл' : 'вышел'}.${activityText ? ` (${activityText})` : ''}`;
  const roleOrder = ['РС', 'СС', 'Курьер', 'Стажёр'];
  const roleMap: Record<string, string> = { rs: 'РС', ss: 'СС', kurier: 'Курьер', stazher: 'Стажёр' };
  const sorted = [...list].sort((a, b) => {
    const ra = roleOrder.indexOf(roleMap[a.role] ?? 'Курьер');
    const rb = roleOrder.indexOf(roleMap[b.role] ?? 'Курьер');
    return ra - rb;
  });
  if (!sorted.length) return header;
  const lines = sorted.map(u => `${u.nickname ?? `ID${u.vk_id}`} (${roleMap[u.role] ?? u.role}) ${u.activity_text}`);
  return `${header}\nНа сервере:\n${lines.join('\n')}`;
}

export async function cmdOnline(ctx: BotCtx) {
  if (!(await requireZhurnal(ctx))) return;
  const activityText = ctx.args.slice(1).join(' ') || (
    (await getUserRole(ctx.userId)) === 'stazher' ? 'экзамен' : 'доставка'
  );
  const user = await getUser(ctx.userId);
  await upsertUser(ctx.userId, user?.first_name ?? '', user?.last_name ?? '');
  const emp = await getEmployee(ctx.userId);
  const nickname = emp?.nickname ?? user?.first_name ?? `ID${ctx.userId}`;
  await openActivitySession(ctx.userId, 'online', activityText);
  const list = await getCurrentOnlineList();
  await sendMessage(ctx.peerId, buildOnlineListText(list, nickname, 'online', activityText));
}

export async function cmdAfk(ctx: BotCtx) {
  if (!(await requireZhurnal(ctx))) return;
  const activityText = ctx.args.slice(1).join(' ') || 'Не у ПК';
  const user = await getUser(ctx.userId);
  await upsertUser(ctx.userId, user?.first_name ?? '', user?.last_name ?? '');
  const emp = await getEmployee(ctx.userId);
  const nickname = emp?.nickname ?? user?.first_name ?? `ID${ctx.userId}`;
  await openActivitySession(ctx.userId, 'afk', activityText);
  const list = await getCurrentOnlineList();
  await sendMessage(ctx.peerId, buildOnlineListText(list, nickname, 'afk', activityText));
}

export async function cmdVyshel(ctx: BotCtx) {
  if (!(await requireZhurnal(ctx))) return;
  const user = await getUser(ctx.userId);
  await upsertUser(ctx.userId, user?.first_name ?? '', user?.last_name ?? '');
  const emp = await getEmployee(ctx.userId);
  const nickname = emp?.nickname ?? user?.first_name ?? `ID${ctx.userId}`;
  await closeActivitySession(ctx.userId);
  const list = await getCurrentOnlineList();
  await sendMessage(ctx.peerId, buildOnlineListText(list, nickname, 'offline', ''));
}

// ============= !стата =============
export async function cmdStata(ctx: BotCtx) {
  const user = await getUser(ctx.userId);
  const emp  = await getEmployee(ctx.userId);
  const nickname = emp?.nickname ?? user?.first_name ?? `ID${ctx.userId}`;
  const stats = await getOnlineStatsForUser(ctx.userId, 7);
  const todayMin = stats[0]?.total_minutes ?? 0;
  const weekMin  = stats.reduce((s: number, r: any) => s + r.total_minutes, 0);
  const rank     = await getOnlineRankThisWeek(ctx.userId);
  const fmt = (m: number) => `${Math.floor(m / 60)}ч. ${m % 60}м.`;
  const online = await getCurrentOnlineList();
  const totalOnline = online.length;
  await sendMessage(
    ctx.peerId,
    `Статистика ${nickname}:\nОнлайн сегодня: ${fmt(todayMin)}\nОнлайн за неделю: ${fmt(weekMin)}\nТоп по онлайну за неделю: ${rank > 0 ? `${rank} место` : 'нет данных'}\nСейчас в сети: ${totalOnline} чел.`,
  );
}

// ============= !профиль =============
export async function cmdProfile(ctx: BotCtx) {
  // Кому смотреть — себе или другому (только РС/СС)
  let targetId = ctx.userId;
  if (ctx.replyMessage) {
    if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
      await sendMessage(ctx.peerId, 'Просмотр чужого профиля доступен только РС и СС');
      return;
    }
    targetId = ctx.replyMessage.from_id;
  }

  const user = await getUser(targetId);
  const emp  = await getEmployee(targetId);
  if (!emp) {
    await sendMessage(ctx.peerId, `Сотрудник ID${targetId} не зарегистрирован в боте.`);
    return;
  }
  const cars  = await getEmployeeCars(targetId);
  const stats = await getOnlineStatsForUser(targetId, 7);
  const weekMin = stats.reduce((s: number, r: any) => s + r.total_minutes, 0);
  const fmt = (m: number) => `${Math.floor(m / 60)}ч. ${m % 60}м.`;
  const carLines = cars.length
    ? cars.map((c: any) => `• ${c.car_name}${c.is_colored ? ' [в цветах]' : ''}${c.is_org_car ? ' (орг.)' : ' (личное)'}`).join('\n')
    : 'Нет машин';

  await sendMessage(
    ctx.peerId,
    `Профиль: ${emp.nickname ?? (user ? `${user.first_name} ${user.last_name}` : `ID${targetId}`)}\nРоль: ${emp.role ?? 'не указана'}\nБанк. счёт: ${emp.bankAccount ?? 'не указан'}\nОнлайн за неделю: ${fmt(weekMin)}\nАвтопарк:\n${carLines}`,
  );
}

// ============= !авто =============
export async function cmdAvto(ctx: BotCtx) {
  const emp = await getEmployee(ctx.userId);
  if (!emp) {
    await sendMessage(ctx.peerId, 'Сначала зарегистрируйтесь: пишите боту сообщества 1 в личные сообщения.');
    return;
  }

  const subCmd = ctx.args[1]?.toLowerCase();

  if (!subCmd || subCmd === 'список') {
    const cars = await getEmployeeCars(ctx.userId);
    if (!cars.length) {
      await sendMessage(ctx.peerId, 'У вас нет добавленных машин.\nДобавьте: !авто добавить [название]\nОрг. авто: !авто орг [название]');
      return;
    }
    const lines = cars.map((c: any) => `• ${c.car_name}${c.is_colored ? ' [в цветах]' : ''}${c.is_org_car ? ' (орг.)' : ' (личное)'}`);
    await sendMessage(ctx.peerId, `Ваш автопарк:\n${lines.join('\n')}`);
    return;
  }

  if (subCmd === 'добавить' || subCmd === 'орг') {
    const carName = ctx.args.slice(2).join(' ');
    if (!carName) {
      await sendMessage(ctx.peerId, `Использование: !авто ${subCmd} [название]`);
      return;
    }
    const allCars = await getAllCars(subCmd === 'орг');
    const found = allCars.find(c => c.name.toLowerCase() === carName.toLowerCase());
    if (!found) {
      await sendMessage(ctx.peerId, `Машина "${carName}" не найдена. Доступные: ${allCars.map(c => c.name).join(', ') || 'нет'}`);
      return;
    }
    const isOrg = subCmd === 'орг';
    const photo = ctx.message.attachments?.find((a: any) => a.type === 'photo');
    const photoId = photo?.photo ? `photo${photo.photo.owner_id}_${photo.photo.id}` : null;
    await addEmployeeCar(ctx.userId, found.id, isOrg, false, photoId);
    await sendMessage(ctx.peerId, `Машина "${found.name}" добавлена в ваш автопарк.`);
    return;
  }

  await sendMessage(ctx.peerId, 'Использование: !авто | !авто добавить [название] | !авто орг [название]');
}

// ============= !категория =============
export async function cmdKategoriya(ctx: BotCtx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
    return;
  }
  const subCmd = ctx.args[1]?.toLowerCase();

  if (!subCmd || subCmd === 'список') {
    const cats = await getCategories(null);
    if (!cats.length) { await sendMessage(ctx.peerId, 'Категории не добавлены.'); return; }
    const lines = cats.map(c => `[${c.id}] ${c.name} (${c.type})`);
    await sendMessage(ctx.peerId, `Категории:\n${lines.join('\n')}`);
    return;
  }

  if (subCmd === 'добавить') {
    // !категория добавить [название] [тип: сет|категория]
    const name = ctx.args[2];
    const type = ctx.args[3]?.toLowerCase() === 'сет' ? 'set' : 'category';
    if (!name) { await sendMessage(ctx.peerId, 'Использование: !категория добавить [название] [тип: сет|категория]'); return; }
    const photo = ctx.message.attachments?.find((a: any) => a.type === 'photo');
    const photoId = photo?.photo ? `photo${photo.photo.owner_id}_${photo.photo.id}` : null;
    const cat = await createCategory(name, type, null, photoId, ctx.userId);
    await sendMessage(ctx.peerId, `Категория "${cat.name}" добавлена (ID: ${cat.id}).`);
    return;
  }

  await sendMessage(ctx.peerId, 'Использование: !категория список | !категория добавить [название] [тип]');
}

// ============= !товар =============
export async function cmdTovar(ctx: BotCtx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
    return;
  }
  const subCmd = ctx.args[1]?.toLowerCase();

  if (!subCmd || subCmd === 'список') {
    const catId = ctx.args[2] ? parseInt(ctx.args[2]) : null;
    if (!catId) { await sendMessage(ctx.peerId, 'Использование: !товар список [ID категории]'); return; }
    const products = await getProductsByCategory(catId);
    if (!products.length) { await sendMessage(ctx.peerId, 'Товары не найдены.'); return; }
    const lines = products.map(p => `[${p.id}] ${p.name} | ${p.price}р. (с/с: ${p.costPrice}р.)`);
    await sendMessage(ctx.peerId, `Товары категории ${catId}:\n${lines.join('\n')}`);
    return;
  }

  if (subCmd === 'добавить') {
    // !товар добавить [catId] [цена] [себестоимость] [название...]
    const catId     = parseInt(ctx.args[2] ?? '0');
    const price     = parseInt(ctx.args[3] ?? '0');
    const costPrice = parseInt(ctx.args[4] ?? '0');
    const name      = ctx.args.slice(5).join(' ');
    if (!catId || !price || !costPrice || !name) {
      await sendMessage(ctx.peerId, 'Использование: !товар добавить [ID категории] [цена] [себестоимость] [название]');
      return;
    }
    const photo = ctx.message.attachments?.find((a: any) => a.type === 'photo');
    const photoId = photo?.photo ? `photo${photo.photo.owner_id}_${photo.photo.id}` : null;
    const product = await createProduct(catId, name, price, costPrice, photoId, ctx.userId);
    await sendMessage(ctx.peerId, `Товар "${product.name}" добавлен (ID: ${product.id}).`);
    return;
  }

  await sendMessage(ctx.peerId, 'Использование: !товар список [catId] | !товар добавить [catId] [цена] [с/с] [название]');
}

// ============= !промокод =============
export async function cmdPromokod(ctx: BotCtx) {
  if (!(await hasPermission(ctx.userId, ctx.peerId, ['rs', 'ss']))) {
    await sendMessage(ctx.peerId, 'Команда доступна только РС и СС');
    return;
  }
  const subCmd = ctx.args[1]?.toLowerCase();

  if (subCmd === 'создать') {
    // !промокод создать [код] [скидка%] [макс. использований] [дней действия]
    const code        = ctx.args[2]?.toUpperCase();
    const discount    = parseInt(ctx.args[3] ?? '0');
    const maxUses     = ctx.args[4] ? parseInt(ctx.args[4]) : null;
    const days        = ctx.args[5] ? parseInt(ctx.args[5]) : null;
    if (!code || !discount || discount < 1 || discount > 100) {
      await sendMessage(ctx.peerId, 'Использование: !промокод создать [КОД] [скидка%] [макс.использований] [дней действия]');
      return;
    }
    const expiresAt = days ? Date.now() + days * 86400000 : null;
    await createPromoCode(code, discount, maxUses, ctx.userId, expiresAt);
    const exp = days ? `, действует ${days} дн.` : '';
    const uses = maxUses ? `, макс. ${maxUses} раз` : '';
    await sendMessage(ctx.peerId, `Промокод ${code} создан: скидка ${discount}%${uses}${exp}.`);
    return;
  }

  await sendMessage(ctx.peerId, 'Использование: !промокод создать [КОД] [скидка%] [макс.использований] [дней действия]');
}

// ============= Маппинг команд =============
export const commands: Record<string, (ctx: BotCtx) => Promise<void>> = {
  'пост':        cmdPost,
  'приказ':      cmdPrikaz,
  'приветствие': cmdGreeting,
  'закреп':      cmdPin,
  'кик':         cmdKick,
  'чат':         cmdChatInfo,
  'увед':        cmdNotify,
  'диагностика': cmdDiagnostics,
  'чс':          cmdBlacklist,
  'мут':         cmdMute,
  'размут':      cmdUnmute,
  // v2 — активность
  'онлайн':      cmdOnline,
  'афк':         cmdAfk,
  'вышел':       cmdVyshel,
  'стата':       cmdStata,
  // v2 — профиль и авто
  'профиль':     cmdProfile,
  'авто':        cmdAvto,
  // v2 — каталог
  'категория':   cmdKategoriya,
  'товар':       cmdTovar,
  // v2 — промокоды
  'промокод':    cmdPromokod,
};
