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

  console.log('[v0] incoming event type:', body.type, '| group_id:', body.group_id);

  // 1. Подтверждение адреса сервера
  if (body.type === 'confirmation') {
    const token = VK_CONFIRMATION_TOKEN?.trim();
    console.log('[v0] VK_CONFIRMATION_TOKEN value:', JSON.stringify(token));
    if (!token) {
      console.error('[v0] VK_CONFIRMATION_TOKEN не задан!');
      return new NextResponse('error', { status: 500 });
    }
    // VK требует ровно строку токена без JSON-обёртки и лишних символов
    console.log('[v0] returning confirmation token:', token);
    return new Response(token, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
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
