// Конфигурация VK бота

export const VK_API_VERSION = '5.131';

export const VK_GROUP1_TOKEN = process.env.VK_GROUP1_TOKEN!;
export const VK_GROUP2_TOKEN = process.env.VK_GROUP2_TOKEN!;
export const VK_USER_TOKEN   = process.env.VK_USER_TOKEN;
export const VK_GROUP1_ID    = process.env.VK_GROUP1_ID!;
export const VK_GROUP2_ID    = process.env.VK_GROUP2_ID!;

export const VK_CALLBACK_SECRET    = process.env.VK_CALLBACK_SECRET!;
export const VK_CONFIRMATION_TOKEN = process.env.VK_CONFIRMATION_TOKEN!;

// ID чатов (peer_ids из env)
export const CHATS = {
  rukovodstvo:     parseInt(process.env.VK_CHAT_RUKOVODSTVO_ID     || '0'),
  ss:              parseInt(process.env.VK_CHAT_SS_ID              || '0'),
  uchebny:         parseInt(process.env.VK_CHAT_UCHEBNY_ID         || '0'),
  doska:           parseInt(process.env.VK_CHAT_DOSKA_ID           || '0'),
  dispetcherskaya: parseInt(process.env.VK_CHAT_DISPETCHERSKAYA_ID || '0'),
  fludilka:        parseInt(process.env.VK_CHAT_FLUDILKA_ID        || '0'),
  zhurnal:         parseInt(process.env.VK_CHAT_ZHURNAL_ID         || '0'),
  sponsor:         parseInt(process.env.VK_CHAT_SPONSOR_ID         || '0'),
} as const;

export type ChatKey = keyof typeof CHATS;

export const ROLE_CHATS = {
  rs:      ['rukovodstvo', 'ss', 'doska', 'dispetcherskaya', 'fludilka', 'zhurnal'],
  ss:      ['ss', 'doska', 'dispetcherskaya', 'fludilka', 'zhurnal'],
  kurier:  ['doska', 'dispetcherskaya', 'fludilka', 'zhurnal'],
  stazher: ['uchebny', 'doska', 'dispetcherskaya'],
} as const;

export type Role = keyof typeof ROLE_CHATS | 'sponsor';
