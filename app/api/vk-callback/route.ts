import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { VK_CALLBACK_SECRET, VK_CONFIRMATION_TOKEN } from '@/lib/bot/config';
import { handleEvent } from '@/lib/bot/events';

export const runtime = 'nodejs';
// Vercel максимальное время выполнения serverless функции
export const maxDuration = 60;

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
    return new NextResponse(VK_CONFIRMATION_TOKEN, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // 2. Проверка секрета
  if (VK_CALLBACK_SECRET && body.secret !== VK_CALLBACK_SECRET) {
    return new NextResponse('forbidden', { status: 403 });
  }

  // 3. Запускаем обработку события ПОСЛЕ отправки ответа "ok" в VK.
  //    after() гарантирует выполнение фоновой задачи уже после того,
  //    как ответ отправлен клиенту (VK получает "ok" мгновенно).
  after(async () => {
    try {
      await handleEvent(body);
    } catch (err: any) {
      console.error('[Bot] Необработанная ошибка события:', err.message);
    }
  });

  return new NextResponse('ok', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}
