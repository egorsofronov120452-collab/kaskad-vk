import { CHATS } from './config';
import { VK_GROUP1_ID } from './config';
import { callVK, sendMessage, getUser } from './vk-api';
import { commands, type BotCtx } from './commands';
import {
  isUserInBlacklist,
  addToBlacklist,
  isUserMuted,
  getGreeting,
} from './db';
import {
  getChatId,
  createUserLink,
  formatBanEndDate,
  formatDateMSK,
} from './utils';

// Приветствие + автокик из ЧС при заходе в чат
export async function handleChatJoin(message: any) {
  const userId: number = message.action.member_id;
  const user = await getUser(userId);
  if (!user) return;

  // Автокик если в ЧС
  const banInfo = await isUserInBlacklist(userId);
  if (banInfo) {
    try {
      await callVK('messages.removeChatUser', {
        chat_id: getChatId(message.peer_id),
        member_id: userId,
      });

      const userLink = createUserLink(user);
      const banEndText = formatBanEndDate(banInfo.endDate);
      await sendMessage(message.peer_id, `${userLink} автоматически удалён (в ЧС до ${banEndText})`);

      if (CHATS.rukovodstvo > 0) {
        const log = `[${formatDateMSK()}] [АВТОКИК]\n${userLink} автоматически удалён из беседы\nПричина: в ЧС до ${banEndText}\nОснование: ${banInfo.reason}`;
        await sendMessage(CHATS.rukovodstvo, log);
      }
    } catch (err: any) {
      console.error('[Bot] Ошибка автокика:', err.message);
    }
    return;
  }

  // Приветствие
  const greeting = await getGreeting(message.peer_id);
  if (greeting) {
    const userLink = createUserLink(user);
    const welcomeText = greeting.text.replace('{user}', userLink);
    await sendMessage(message.peer_id, welcomeText, {
      attachment: greeting.attachments.length ? greeting.attachments.join(',') : undefined,
    });
  }
}

// Самолив — кик из всех чатов + кнопки в руководстве
export async function handleChatLeave(message: any) {
  const userId: number = message.action.member_id;
  const kickerId: number = message.from_id;

  // Если кик администратором — не обрабатываем
  if (kickerId !== userId) return;

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
    } catch {
      // ignore
    }
  }

  // Кнопки в чат руководства
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

  try {
    await sendMessage(
      CHATS.rukovodstvo,
      `[${formatDateMSK()}] [САМОЛИВ]\n${userLink} покинул беседу\n\nЗанести в ЧС?`,
      { keyboard: JSON.stringify(keyboard) },
    );
  } catch (err: any) {
    console.error('[Bot] Ошибка отправки самолива:', err.message);
  }
}

// Нажатие на кнопку (callback)
export async function handleCallback(event: any) {
  try {
    const payload =
      typeof event.object.payload === 'string'
        ? JSON.parse(event.object.payload)
        : event.object.payload;

    const peerId: number = event.object.peer_id;
    const userId: number = payload.userId;
    const user = await getUser(userId);
    const userLink = user ? createUserLink(user) : `ID${userId}`;
    const originalCmid = event.object.conversation_message_id;

    if (payload.action === 'ban') {
      const days: number = payload.days;
      const moderator = await getUser(event.object.user_id);
      const modName = moderator
        ? `${moderator.first_name} ${moderator.last_name}`
        : `ID${event.object.user_id}`;

      await addToBlacklist(userId, days, `Самолив (${modName})`, event.object.user_id);

      const banEndDate = days === 0 ? 0 : Date.now() + days * 24 * 60 * 60 * 1000;
      const banEndText = formatBanEndDate(banEndDate);

      await callVK('messages.edit', {
        peer_id: peerId,
        conversation_message_id: originalCmid,
        message: `[${formatDateMSK()}] [САМОЛИВ]\n${userLink} покинул беседу\n\nОбработано: добавлен в ЧС до ${banEndText}`,
      });
    } else if (payload.action === 'return') {
      await callVK('messages.edit', {
        peer_id: peerId,
        conversation_message_id: originalCmid,
        message: `[${formatDateMSK()}] [САМОЛИВ]\n${userLink} покинул беседу\n\nОбработано: НЕ добавлен в ЧС`,
      });
    }

    await callVK('messages.sendMessageEventAnswer', {
      event_id: event.object.event_id,
      user_id: event.object.user_id,
      peer_id: peerId,
    });
  } catch (err: any) {
    console.error('[Bot] Ошибка обработки callback:', err.message);
  }
}

// Главный роутер событий
export async function handleEvent(event: any) {
  try {
    // Новое сообщение
    if (event.type === 'message_new' && event.object?.message) {
      const message = event.object.message;

      // События чата (join / leave)
      if (message.action) {
        if (message.action.type === 'chat_invite_user') {
          await handleChatJoin(message);
        } else if (message.action.type === 'chat_kick_user') {
          await handleChatLeave(message);
        }
        return;
      }

      // Мут — удаляем сообщение
      const muteInfo = await isUserMuted(message.from_id);
      if (muteInfo) {
        try {
          await callVK('messages.delete', {
            peer_id: message.peer_id,
            delete_for_all: 1,
            cmids: message.conversation_message_id,
          });
        } catch (err: any) {
          console.error('[Bot] Ошибка удаления сообщения замученного:', err.message);
        }
        return;
      }

      // Команды
      const text: string = message.text?.trim() ?? '';
      if (!text.startsWith('!')) return;

      const parts = text.split(/\s+/);
      const command = parts[0].slice(1).toLowerCase();

      if (commands[command]) {
        const ctx: BotCtx = {
          message,
          userId: message.from_id,
          peerId: message.peer_id,
          args: parts,
          replyMessage: message.reply_message ?? null,
        };
        await commands[command](ctx);
      }
    }

    // Callback (кнопки)
    if (event.type === 'message_event') {
      await handleCallback(event);
    }

    // Новый пост на стене группы 1 — пересылаем в Доску объявлений
    if (event.type === 'wall_post_new' && event.object) {
      const post = event.object;
      if (Math.abs(post.owner_id) === parseInt(VK_GROUP1_ID) && CHATS.doska > 0) {
        try {
          await sendMessage(CHATS.doska, '', {
            attachment: `wall${post.owner_id}_${post.id}`,
          });
        } catch (err: any) {
          console.error('[Bot] Ошибка пересылки поста:', err.message);
        }
      }
    }
  } catch (err: any) {
    console.error('[Bot] Ошибка обработки события:', err.message);
  }
}
