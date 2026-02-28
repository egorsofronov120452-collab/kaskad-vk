import { CHATS } from './config';

export function peerIdToChatId(peerId: number) {
  return peerId - 2_000_000_000;
}

export function chatIdToPeerId(chatId: number) {
  return chatId + 2_000_000_000;
}

export function getChatId(chatPeerId: number) {
  return chatPeerId > 2_000_000_000 ? chatPeerId - 2_000_000_000 : chatPeerId;
}

export function formatBanEndDate(endDate: number): string {
  if (endDate === 0) return 'ПЕРМАНЕНТНО';
  const mskDate = new Date(
    new Date(endDate).toLocaleString('en-US', { timeZone: 'Europe/Moscow' }),
  );
  const dd  = mskDate.getDate().toString().padStart(2, '0');
  const mm  = (mskDate.getMonth() + 1).toString().padStart(2, '0');
  const yy  = mskDate.getFullYear();
  const hh  = mskDate.getHours().toString().padStart(2, '0');
  const min = mskDate.getMinutes().toString().padStart(2, '0');
  return `${dd}.${mm}.${yy} ${hh}:${min}`;
}

export function formatDateMSK(timestamp = Date.now()): string {
  return formatBanEndDate(timestamp);
}

export function getChatName(peerId: number): string {
  const names: Record<number, string> = {
    [CHATS.rukovodstvo]:     'Руководство',
    [CHATS.ss]:              'Старший Состав',
    [CHATS.uchebny]:         'Учебный Центр',
    [CHATS.doska]:           'Доска Объявлений',
    [CHATS.dispetcherskaya]: 'Диспетчерская',
    [CHATS.fludilka]:        'Флудилка',
    [CHATS.zhurnal]:         'Журнал Активности',
    [CHATS.sponsor]:         'Спонсорская беседа',
  };
  return names[peerId] ?? `Чат ${peerIdToChatId(peerId)}`;
}

export function getChatIdByAlias(alias: string): number | undefined {
  const a = alias.toLowerCase();
  const map: Record<string, number> = {
    'рс':            CHATS.rukovodstvo,
    'сс':            CHATS.ss,
    'уц':            CHATS.uchebny,
    'до':            CHATS.doska,
    'дисп':          CHATS.dispetcherskaya,
    'диспетчерская': CHATS.dispetcherskaya,
    'флуд':          CHATS.fludilka,
    'жа':            CHATS.zhurnal,
    'журнал':        CHATS.zhurnal,
    'спонсор':       CHATS.sponsor,
  };
  return map[a];
}

export function extractUserId(link: string): number | null {
  // Чистим строку от пробелов
  const s = link.trim();
  const patterns = [
    // VK mention format: [id123|Имя] или [id123|\u200b]
    /^\[id(\d+)\|/,
    // URL: https://vk.com/id123
    /vk\.com\/id(\d+)/,
    // Старый формат с vk.com внутри скобок: [vk.com/id123|...]
    /\[vk\.com\/id(\d+)\|/,
    // Просто: id123
    /^id(\d+)$/i,
    // Просто число
    /^(\d+)$/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return parseInt(m[1]);
  }
  return null;
}

export function createUserLink(user: { id: number; first_name: string; last_name: string }) {
  return `[vk.com/id${user.id}|${user.first_name} ${user.last_name}]`;
}

export function parseMuteDuration(text: string): number | null {
  const t = text.toLowerCase().trim();

  if (/(\d+)\s*(мин|минут|минуты|м|min)/.test(t)) {
    const m = t.match(/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }
  if (/(\d+)\s*(час|часа|часов|ч|h|hour)/.test(t)) {
    const m = t.match(/(\d+)/);
    return m ? parseInt(m[1]) * 60 : null;
  }
  if (/(\d+)\s*(день|дня|дней|д|d|day)/.test(t)) {
    const m = t.match(/(\d+)/);
    return m ? parseInt(m[1]) * 60 * 24 : null;
  }
  return null;
}

export function collectAttachments(attachments: any[]): string[] {
  const result: string[] = [];
  for (const att of attachments ?? []) {
    if (att.type === 'photo' && att.photo) {
      let id = `photo${att.photo.owner_id}_${att.photo.id}`;
      if (att.photo.access_key) id += `_${att.photo.access_key}`;
      result.push(id);
    } else if (att.type === 'video' && att.video) {
      let id = `video${att.video.owner_id}_${att.video.id}`;
      if (att.video.access_key) id += `_${att.video.access_key}`;
      result.push(id);
    } else if (att.type === 'doc' && att.doc) {
      let id = `doc${att.doc.owner_id}_${att.doc.id}`;
      if (att.doc.access_key) id += `_${att.doc.access_key}`;
      result.push(id);
    } else if (att.type === 'audio' && att.audio) {
      result.push(`audio${att.audio.owner_id}_${att.audio.id}`);
    }
  }
  return result;
}
