import { CHATS } from '@/lib/bot/config';

// Серверный компонент — process.env читается только на сервере
export const dynamic = 'force-dynamic';

const COMMANDS = [
  { cmd: '!пост', desc: 'Опубликовать сообщение в группу 2 (РС, СС)' },
  { cmd: '!приказ', desc: 'Опубликовать приказ в группу 1 (РС, СС)' },
  { cmd: '!приветствие [чат]', desc: 'Установить приветствие для чата (РС)' },
  { cmd: '!закреп [чат]', desc: 'Обновить закреплённое сообщение (РС)' },
  { cmd: '!кик [ссылка] [дни|perm|спонсор]', desc: 'Кикнуть пользователя (РС, СС)' },
  { cmd: '!чс список / разбан / проверка', desc: 'Управление чёрным списком (РС, СС)' },
  { cmd: '!мут [ссылка] [время] [причина]', desc: 'Замутить пользователя (РС, СС)' },
  { cmd: '!размут [ссылка]', desc: 'Снять мут (РС, СС)' },
  { cmd: '!увед', desc: 'Уведомить участников чата (РС, СС)' },
  { cmd: '!диагностика', desc: 'Проверка доступа к чатам (РС)' },
  { cmd: '!чат', desc: 'Информация о текущем чате' },
];

const CHAT_ALIASES: [string, string][] = [
  ['рс', 'Руководство'],
  ['сс', 'Старший Состав'],
  ['уц', 'Учебный Центр'],
  ['до', 'Доска Объявлений'],
  ['дисп', 'Диспетчерская'],
  ['флуд', 'Флудилка'],
  ['жа', 'Журнал Активности'],
  ['спонсор', 'Спонсорская'],
];

const ENV_VARS = [
  'VK_GROUP1_TOKEN',
  'VK_GROUP2_TOKEN',
  'VK_USER_TOKEN',
  'VK_GROUP1_ID',
  'VK_GROUP2_ID',
  'VK_CONFIRMATION_TOKEN',
  'VK_CALLBACK_SECRET',
  'DATABASE_URL',
] as const;

function EnvRow({ label, isSet }: { label: string; isSet: boolean }) {
  return (
    <tr>
      <td className="py-1 pr-4 font-mono text-sm text-[#b0b8c8]">{label}</td>
      <td>
        <span
          className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
            isSet ? 'bg-[#1a3a2a] text-[#4ade80]' : 'bg-[#3a1a1a] text-[#f87171]'
          }`}
        >
          {isSet ? 'задан' : 'не задан'}
        </span>
      </td>
    </tr>
  );
}

export default function Home() {
  // Читаем env только на сервере и передаём простые булевы значения
  const envStatus = ENV_VARS.map((key) => ({
    label: key,
    isSet: Boolean(process.env[key]),
  }));

  const chatsConfigured = Object.values(CHATS).filter((v) => v > 0).length;
  const totalChats = Object.keys(CHATS).length;

  return (
    <main className="min-h-screen bg-[#0f1117] text-[#e2e8f0] font-sans">
      <div className="max-w-3xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-3 h-3 rounded-full bg-[#4ade80] shadow-[0_0_8px_#4ade80]" />
            <span className="text-xs uppercase tracking-widest text-[#4ade80] font-semibold">Online</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Kaskad VK Bot</h1>
          <p className="text-[#64748b] mt-1 text-sm">VK Callback API — работает на Vercel + Neon</p>
        </div>

        {/* Callback endpoint */}
        <section className="mb-8 rounded-xl border border-[#1e2a3a] bg-[#131820] p-5">
          <h2 className="text-xs uppercase tracking-widest text-[#64748b] mb-3 font-semibold">Callback endpoint</h2>
          <code className="block rounded-lg bg-[#0a0d13] border border-[#1e2a3a] px-4 py-3 text-[#93c5fd] font-mono text-sm select-all">
            https://YOUR-DOMAIN/api/vk-callback
          </code>
          <p className="mt-3 text-xs text-[#475569]">
            Укажи этот адрес в настройках Callback API группы ВКонтакте.
          </p>
        </section>

        {/* Env status */}
        <section className="mb-8 rounded-xl border border-[#1e2a3a] bg-[#131820] p-5">
          <h2 className="text-xs uppercase tracking-widest text-[#64748b] mb-3 font-semibold">
            Переменные окружения
          </h2>
          <table className="w-full">
            <tbody>
              {envStatus.map(({ label, isSet }) => (
                <EnvRow key={label} label={label} isSet={isSet} />
              ))}
            </tbody>
          </table>
        </section>

        {/* Chats status */}
        <section className="mb-8 rounded-xl border border-[#1e2a3a] bg-[#131820] p-5">
          <h2 className="text-xs uppercase tracking-widest text-[#64748b] mb-3 font-semibold">
            Чаты{' '}
            <span
              className={`ml-2 text-xs font-semibold ${
                chatsConfigured === totalChats ? 'text-[#4ade80]' : 'text-[#fbbf24]'
              }`}
            >
              {chatsConfigured}/{totalChats}
            </span>
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(CHATS).map(([key, peerId]) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg bg-[#0a0d13] border border-[#1e2a3a] px-3 py-2"
              >
                <span className="text-sm text-[#cbd5e1] capitalize">{key}</span>
                <span className={`text-xs font-mono ${peerId > 0 ? 'text-[#4ade80]' : 'text-[#475569]'}`}>
                  {peerId > 0 ? peerId : '\u2014'}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-[#475569]">
            Peer ID можно узнать командой{' '}
            <code className="text-[#93c5fd]">!чат</code> в нужной беседе.
          </p>
        </section>

        {/* Commands */}
        <section className="mb-8 rounded-xl border border-[#1e2a3a] bg-[#131820] p-5">
          <h2 className="text-xs uppercase tracking-widest text-[#64748b] mb-3 font-semibold">Команды</h2>
          <div className="flex flex-col gap-1">
            {COMMANDS.map(({ cmd, desc }) => (
              <div key={cmd} className="flex gap-3 py-1.5 border-b border-[#1e2a3a] last:border-0">
                <code className="text-[#93c5fd] font-mono text-xs whitespace-nowrap min-w-[220px]">{cmd}</code>
                <span className="text-[#64748b] text-xs">{desc}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {CHAT_ALIASES.map(([alias, name]) => (
              <span key={alias} className="text-xs">
                <code className="text-[#93c5fd]">{alias}</code>
                <span className="text-[#475569]"> = {name}</span>
              </span>
            ))}
          </div>
        </section>

        {/* Footer */}
        <p className="text-center text-xs text-[#334155]">
          Kaskad VK Bot &middot; Next.js 16 + Neon Postgres &middot; VK Callback API
        </p>
      </div>
    </main>
  );
}
