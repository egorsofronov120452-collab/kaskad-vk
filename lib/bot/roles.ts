import { CHATS, type Role } from './config';
import { callVK } from './vk-api';

// Определяет роль по чату (быстрый фолбэк)
export function getRoleByChat(peerId: number): Role | null {
  if (peerId === CHATS.rukovodstvo) return 'rs';
  if (peerId === CHATS.ss) return 'ss';
  if (
    peerId === CHATS.fludilka ||
    peerId === CHATS.dispetcherskaya ||
    peerId === CHATS.zhurnal ||
    peerId === CHATS.doska
  ) return 'kurier';
  if (peerId === CHATS.uchebny) return 'stazher';
  if (peerId === CHATS.sponsor) return 'sponsor';
  return null;
}

// Определяет реальную роль пользователя по членству в чатах
export async function getUserRole(userId: number): Promise<Role | null> {
  const checks: [number, Role][] = [
    [CHATS.rukovodstvo, 'rs'],
    [CHATS.ss, 'ss'],
    [CHATS.fludilka, 'kurier'],
    [CHATS.uchebny, 'stazher'],
  ];

  for (const [chatPeerId, role] of checks) {
    if (!chatPeerId) continue;
    try {
      const members = await callVK('messages.getConversationMembers', {
        peer_id: chatPeerId,
      });
      const isMember = (members.items as any[]).some(
        m => m.member_id === userId,
      );
      if (isMember) return role;
    } catch {
      // Чат недоступен — пропускаем
    }
  }
  return null;
}

// Проверяет, является ли пользователь администратором беседы
export async function isChatAdmin(peerId: number, userId: number): Promise<boolean> {
  try {
    const members = await callVK('messages.getConversationMembers', {
      peer_id: peerId,
    });
    const member = (members.items as any[]).find(m => m.member_id === userId);
    return !!(member && (member.is_admin || member.is_owner));
  } catch {
    return false;
  }
}

// Основная проверка прав
export async function hasPermission(
  userId: number,
  peerId: number,
  requiredRoles: Role[],
): Promise<boolean> {
  const realRole = await getUserRole(userId);
  if (realRole && requiredRoles.includes(realRole)) return true;

  const chatRole = getRoleByChat(peerId);
  if (chatRole && requiredRoles.includes(chatRole)) return true;

  return isChatAdmin(peerId, userId);
}
