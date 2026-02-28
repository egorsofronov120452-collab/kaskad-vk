'use client';

import { useEffect, useState, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────────

interface OnlineUser {
  vk_id: number;
  status: 'online' | 'afk';
  activity_text: string;
  started_at: number;
  nickname: string | null;
  role: string | null;
}

interface ActiveOrder {
  id: number;
  nickname: string;
  delivery_place?: string;
  status: string;
  total_price?: number;
  final_price?: number;
  payment_type?: string;
  created_at: number;
}

interface BotStatus {
  id: number;
  name: string;
  endpoint: string;
  configured: boolean;
}

interface DashboardData {
  onlineList: OnlineUser[];
  employees: number;
  categories: number;
  activeDelivery: ActiveOrder[];
  activeTaxi: ActiveOrder[];
  todayOrders: number;
  todayRevenue: number;
  botStatuses: BotStatus[];
  error?: string;
}

// ─── Helpers ───────────────────────────────────────────────────

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  pending:    'Ожидает',
  accepted:   'Принят',
  preparing:  'Готовится',
  delivering: 'Едет',
  delivered:  'Доставлен',
  cancelled:  'Отменён',
};

const TAXI_STATUS_LABELS: Record<string, string> = {
  pending:   'Ожидает',
  accepted:  'Принят',
  enroute:   'В пути',
  delivered: 'Завершён',
  cancelled: 'Отменён',
};

function formatDuration(startedAt: number): string {
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  if (sec < 60) return `${sec}с`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}м`;
  return `${Math.floor(min / 60)}ч ${min % 60}м`;
}

function timeAgo(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// ─── Sub-components ────────────────────────────────────────────

function Pill({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        ok
          ? 'bg-[rgba(34,197,94,0.12)] text-[var(--color-success)]'
          : 'bg-[rgba(239,68,68,0.12)] text-[var(--color-danger)]'
      }`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${ok ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]'}`} />
      {label ?? (ok ? 'OK' : 'OFF')}
    </span>
  );
}

function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  const colorMap: Record<string, string> = {
    pending:   'text-[var(--color-warning)]  bg-[rgba(245,158,11,0.12)]',
    accepted:  'text-[var(--color-info)]     bg-[rgba(59,130,246,0.12)]',
    preparing: 'text-[var(--color-info)]     bg-[rgba(59,130,246,0.12)]',
    delivering:'text-[var(--color-lime)]     bg-[rgba(132,204,22,0.12)]',
    enroute:   'text-[var(--color-lime)]     bg-[rgba(132,204,22,0.12)]',
    delivered: 'text-[var(--color-success)]  bg-[rgba(34,197,94,0.12)]',
    cancelled: 'text-[var(--color-danger)]   bg-[rgba(239,68,68,0.12)]',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${colorMap[status] ?? 'text-[var(--color-muted)]'}`}>
      {labels[status] ?? status}
    </span>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] uppercase tracking-widest text-[var(--color-muted)] font-semibold mb-3">
      {children}
    </h2>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card className="p-4 flex flex-col gap-1">
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-muted)] font-semibold">{label}</p>
      <p className="text-2xl font-bold text-[var(--color-foreground)]">{value}</p>
      {sub && <p className="text-xs text-[var(--color-muted-foreground)]">{sub}</p>}
    </Card>
  );
}

function ActivityDot({ status }: { status: 'online' | 'afk' }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${status === 'online' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'}`} />
  );
}

// ─── Main Dashboard ────────────────────────────────────────────

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      const json = await res.json();
      setData(json);
      setLastUpdated(new Date());
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const onlineCount = data?.onlineList.filter(u => u.status === 'online').length ?? 0;
  const afkCount    = data?.onlineList.filter(u => u.status === 'afk').length ?? 0;

  return (
    <main className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] font-sans">
      <div className="max-w-5xl mx-auto px-4 py-8 md:px-8">

        {/* ── Header ── */}
        <header className="mb-8 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-success)]" />
              <span className="text-[10px] uppercase tracking-widest text-[var(--color-success)] font-semibold">Live</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="gradient-text">Kaskad</span>
              <span className="text-[var(--color-muted-foreground)] font-normal"> / Панель управления</span>
            </h1>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">VK Callback API · Next.js 16 · Neon</p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <p className="text-xs text-[var(--color-muted)]">
                Обновлено в {lastUpdated.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
            )}
            <button
              onClick={fetchData}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-1.5 text-xs text-[var(--color-foreground)] hover:border-[var(--color-muted)] transition-colors"
            >
              Обновить
            </button>
          </div>
        </header>

        {/* ── Loading state ── */}
        {loading && (
          <div className="flex items-center justify-center py-24 text-[var(--color-muted)]">
            <span className="text-sm">Загрузка...</span>
          </div>
        )}

        {/* ── Error state ── */}
        {!loading && data?.error && (
          <Card className="p-5 border-[var(--color-danger)] mb-6">
            <p className="text-sm text-[var(--color-danger)]">Ошибка: {data.error}</p>
          </Card>
        )}

        {!loading && data && !data.error && (
          <div className="flex flex-col gap-6">

            {/* ── Bot statuses ── */}
            <Card className="p-5">
              <SectionTitle>Боты</SectionTitle>
              <div className="flex flex-col gap-2">
                {data.botStatuses.map(bot => (
                  <div key={bot.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Pill ok={bot.configured} />
                      <span className="text-sm text-[var(--color-foreground)]">{bot.name}</span>
                    </div>
                    <code className="text-xs font-mono text-[var(--color-muted)]">{bot.endpoint}</code>
                  </div>
                ))}
              </div>
            </Card>

            {/* ── Stats row ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Онлайн" value={onlineCount} sub={afkCount > 0 ? `+${afkCount} AFK` : undefined} />
              <StatCard label="Сотрудников" value={data.employees} sub="в базе" />
              <StatCard label="Заказов сегодня" value={data.todayOrders} />
              <StatCard
                label="Выручка сегодня"
                value={data.todayRevenue > 0 ? `${data.todayRevenue.toLocaleString('ru-RU')}₽` : '—'}
              />
            </div>

            {/* ── Online list ── */}
            <Card className="p-5">
              <SectionTitle>
                {`Онлайн — ${data.onlineList.length} чел.`}
              </SectionTitle>
              {data.onlineList.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">Никого нет онлайн</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {data.onlineList.map(u => (
                    <div
                      key={u.vk_id}
                      className="flex items-center gap-2 rounded-lg bg-[var(--color-surface-elevated)] border border-[var(--color-border-subtle)] px-3 py-2"
                    >
                      <ActivityDot status={u.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--color-foreground)] truncate">
                          {u.nickname ?? `id${u.vk_id}`}
                        </p>
                        <p className="text-xs text-[var(--color-muted)]">
                          {u.role ? `${u.role} · ` : ''}{u.activity_text}
                        </p>
                      </div>
                      <span className="text-xs font-mono text-[var(--color-muted)] shrink-0">
                        {formatDuration(u.started_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* ── Active orders ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Delivery */}
              <Card className="p-5">
                <SectionTitle>
                  {`Доставка — ${data.activeDelivery.length} заказов`}
                </SectionTitle>
                {data.activeDelivery.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted)]">Нет активных заказов</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {data.activeDelivery.map(o => (
                      <div
                        key={o.id}
                        className="rounded-lg bg-[var(--color-surface-elevated)] border border-[var(--color-border-subtle)] px-3 py-2"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-mono text-[var(--color-muted)]">#{o.id}</span>
                          <StatusBadge status={o.status} labels={DELIVERY_STATUS_LABELS} />
                        </div>
                        <p className="text-sm text-[var(--color-foreground)] font-medium">{o.nickname}</p>
                        {o.delivery_place && (
                          <p className="text-xs text-[var(--color-muted)] truncate">{o.delivery_place}</p>
                        )}
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-[var(--color-muted-foreground)]">{timeAgo(o.created_at)}</span>
                          {o.total_price != null && (
                            <span className="text-xs font-semibold text-[var(--color-accent)]">{o.total_price}₽</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Taxi */}
              <Card className="p-5">
                <SectionTitle>
                  {`Такси — ${data.activeTaxi.length} заказов`}
                </SectionTitle>
                {data.activeTaxi.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted)]">Нет активных заказов</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {data.activeTaxi.map(o => (
                      <div
                        key={o.id}
                        className="rounded-lg bg-[var(--color-surface-elevated)] border border-[var(--color-border-subtle)] px-3 py-2"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-mono text-[var(--color-muted)]">#{o.id}</span>
                          <StatusBadge status={o.status} labels={TAXI_STATUS_LABELS} />
                        </div>
                        <p className="text-sm text-[var(--color-foreground)] font-medium">{o.nickname}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-[var(--color-muted-foreground)]">{timeAgo(o.created_at)}</span>
                          <div className="flex items-center gap-2">
                            {o.payment_type && (
                              <span className="text-xs text-[var(--color-muted)]">{o.payment_type}</span>
                            )}
                            {o.final_price != null && (
                              <span className="text-xs font-semibold text-[var(--color-accent)]">{o.final_price}₽</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* ── Callback endpoints ── */}
            <Card className="p-5">
              <SectionTitle>Callback endpoints</SectionTitle>
              <div className="flex flex-col gap-2">
                {data.botStatuses.map(bot => (
                  <div key={bot.id} className="flex flex-col gap-0.5">
                    <span className="text-xs text-[var(--color-muted)]">{bot.name}</span>
                    <code className="rounded-lg bg-[var(--color-surface-elevated)] border border-[var(--color-border-subtle)] px-3 py-2 text-xs font-mono text-[var(--color-info)] select-all break-all">
                      {typeof window !== 'undefined' ? window.location.origin : 'https://YOUR-DOMAIN.vercel.app'}
                      {bot.endpoint}
                    </code>
                  </div>
                ))}
              </div>
            </Card>

          </div>
        )}

        {/* ── Footer ── */}
        <footer className="mt-12 text-center text-xs text-[var(--color-muted)]">
          Kaskad VK Bot · обновление каждые 15 сек
        </footer>
      </div>
    </main>
  );
}
