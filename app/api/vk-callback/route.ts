import { NextRequest, NextResponse } from 'next/server';
import { VK_CALLBACK_SECRET, VK_CONFIRMATION_TOKEN } from '@/lib/bot/config';
import { handleEvent } from '@/lib/bot/events';

export const runtime = 'nodejs';

// VK шлёт POST на этот endpoint
export async function POST(req: NextRequest) {
  let body: any;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // 1. Подтверждение адреса сервера
  if (body.type === 'confirmation') {
    if (!VK_CONFIRMATION_TOKEN) {
      console.error('[Bot] VK_CONFIRMATION_TOKEN не задан!');
      return new NextResponse('error', { status: 500 });
    }
    return new NextResponse(VK_CONFIRMATION_TOKEN, { status: 200 });
  }

  // 2. Проверка секрета
  if (VK_CALLBACK_SECRET && body.secret !== VK_CALLBACK_SECRET) {
    return new NextResponse('forbidden', { status: 403 });
  }

  // 3. Обрабатываем событие асинхронно — VK ждёт ответ "ok" как можно быстрее
  // Используем waitUntil если доступен, иначе просто не ждём
  const handler = handleEvent(body).catch(err =>
    console.error('[Bot] Необработанная ошибка события:', err),
  );

  // В Next.js App Router можно использовать ctx.waitUntil через NextFetchEvent,
  // но для простоты запускаем и не ждём — Vercel serverless продолжит выполнение
  // пока не закроется соединение
  await handler;

  return new NextResponse('ok', { status: 200 });
}
