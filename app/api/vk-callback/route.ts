import { NextRequest, NextResponse, after } from 'next/server';
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
    // Читаем прямо из process.env внутри handler — гарантированно актуальное значение
    const token = (process.env.VK_CONFIRMATION_TOKEN ?? '').trim();
    if (!token) {
      console.error('[Bot] VK_CONFIRMATION_TOKEN не задан!');
      return new NextResponse('error', { status: 500 });
    }
    // VK требует ровно строку токена без JSON-обёртки и лишних символов
    return new Response(token, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // 2. Проверка секрета
  const callbackSecret = process.env.VK_CALLBACK_SECRET ?? '';
  if (callbackSecret && body.secret !== callbackSecret) {
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
