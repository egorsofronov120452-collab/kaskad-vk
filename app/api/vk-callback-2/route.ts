import { NextRequest, NextResponse, after } from 'next/server';
import { handleClientEvent } from '@/lib/bot/client-events';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Callback API для сообщества 2 (клиентский бот доставки)
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.type === 'confirmation') {
    const token = (process.env.VK_CONFIRMATION_TOKEN2 ?? '').trim();
    if (!token) {
      console.error('[Bot2] VK_CONFIRMATION_TOKEN2 не задан!');
      return new NextResponse('error', { status: 500 });
    }
    return new Response(token, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const secret = process.env.VK_CALLBACK_SECRET2 ?? '';
  if (secret && body.secret !== secret) {
    return new NextResponse('forbidden', { status: 403 });
  }

  after(async () => {
    try {
      await handleClientEvent(body, 2);
    } catch (err: any) {
      console.error('[Bot2] Необработанная ошибка события:', err.message);
    }
  });

  return new NextResponse('ok', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}
