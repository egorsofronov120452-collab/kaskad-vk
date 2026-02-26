import { neon } from '@neondatabase/serverless';
import { formatBanEndDate } from './utils';

const sql = neon(process.env.DATABASE_URL!);

// ============= BLACKLIST =============

export interface BanInfo {
  endDate: number;
  reason: string;
  bannedAt: number;
  bannedBy: number | null;
}

export async function isUserInBlacklist(userId: number): Promise<BanInfo | null> {
  const rows = await sql`
    SELECT end_date, reason, banned_at, banned_by
    FROM blacklist
    WHERE user_id = ${userId}
  `;
  if (!rows.length) return null;

  const row = rows[0] as any;
  const ban: BanInfo = {
    endDate:  Number(row.end_date),
    reason:   row.reason,
    bannedAt: Number(row.banned_at),
    bannedBy: row.banned_by ? Number(row.banned_by) : null,
  };

  // Перманентный бан
  if (ban.endDate === 0) return ban;

  // Временный бан истёк — удаляем
  if (ban.endDate <= Date.now()) {
    await removeFromBlacklist(userId);
    return null;
  }

  return ban;
}

export async function addToBlacklist(
  userId: number,
  days: number,
  reason = 'Нарушение правил',
  bannedBy: number | null = null,
) {
  const now = Date.now();
  const endDate = days === 0 || days === 999 ? 0 : now + days * 24 * 60 * 60 * 1000;

  await sql`
    INSERT INTO blacklist (user_id, end_date, reason, banned_at, banned_by)
    VALUES (${userId}, ${endDate}, ${reason}, ${now}, ${bannedBy})
    ON CONFLICT (user_id) DO UPDATE
      SET end_date  = EXCLUDED.end_date,
          reason    = EXCLUDED.reason,
          banned_at = EXCLUDED.banned_at,
          banned_by = EXCLUDED.banned_by
  `;
}

export async function removeFromBlacklist(userId: number): Promise<boolean> {
  const result = await sql`DELETE FROM blacklist WHERE user_id = ${userId}`;
  return (result as any).count > 0;
}

export async function getAllBlacklist(): Promise<(BanInfo & { userId: number })[]> {
  const rows = await sql`SELECT * FROM blacklist ORDER BY banned_at DESC`;
  const now = Date.now();
  return (rows as any[])
    .filter(r => Number(r.end_date) === 0 || Number(r.end_date) > now)
    .map(r => ({
      userId:   Number(r.user_id),
      endDate:  Number(r.end_date),
      reason:   r.reason,
      bannedAt: Number(r.banned_at),
      bannedBy: r.banned_by ? Number(r.banned_by) : null,
    }));
}

// ============= MUTES =============

export interface MuteInfo {
  endDate: number;
  reason: string;
  mutedAt: number;
  mutedBy: number | null;
}

export async function isUserMuted(userId: number): Promise<MuteInfo | null> {
  const rows = await sql`
    SELECT end_date, reason, muted_at, muted_by
    FROM mutes
    WHERE user_id = ${userId}
  `;
  if (!rows.length) return null;

  const row = rows[0] as any;
  const mute: MuteInfo = {
    endDate: Number(row.end_date),
    reason:  row.reason,
    mutedAt: Number(row.muted_at),
    mutedBy: row.muted_by ? Number(row.muted_by) : null,
  };

  if (mute.endDate <= Date.now()) {
    await removeMute(userId);
    return null;
  }

  return mute;
}

export async function addMute(
  userId: number,
  minutes: number,
  reason: string,
  mutedBy: number | null,
) {
  const now = Date.now();
  const endDate = now + minutes * 60 * 1000;

  await sql`
    INSERT INTO mutes (user_id, end_date, reason, muted_at, muted_by)
    VALUES (${userId}, ${endDate}, ${reason}, ${now}, ${mutedBy})
    ON CONFLICT (user_id) DO UPDATE
      SET end_date = EXCLUDED.end_date,
          reason   = EXCLUDED.reason,
          muted_at = EXCLUDED.muted_at,
          muted_by = EXCLUDED.muted_by
  `;
}

export async function removeMute(userId: number): Promise<boolean> {
  const result = await sql`DELETE FROM mutes WHERE user_id = ${userId}`;
  return (result as any).count > 0;
}

// ============= GREETINGS =============

export interface Greeting {
  text: string;
  attachments: string[];
}

export async function getGreeting(peerId: number): Promise<Greeting | null> {
  const rows = await sql`SELECT text, attachments FROM greetings WHERE peer_id = ${peerId}`;
  if (!rows.length) return null;
  const row = rows[0] as any;
  return {
    text:        row.text,
    attachments: JSON.parse(row.attachments || '[]'),
  };
}

export async function setGreeting(peerId: number, text: string, attachments: string[]) {
  await sql`
    INSERT INTO greetings (peer_id, text, attachments)
    VALUES (${peerId}, ${text}, ${JSON.stringify(attachments)})
    ON CONFLICT (peer_id) DO UPDATE
      SET text        = EXCLUDED.text,
          attachments = EXCLUDED.attachments
  `;
}
