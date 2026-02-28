import { NextResponse } from 'next/server';
import { getCurrentOnlineList, getCategories, getOnlineStatsForUser, getAllEmployees } from '@/lib/bot/db';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sql = neon(process.env.DATABASE_URL!);

export async function GET() {
  try {
    const [onlineList, employees, rootCategories] = await Promise.all([
      getCurrentOnlineList(),
      getAllEmployees(),
      getCategories(null),
    ]);

    // Active delivery orders
    const activeDelivery = await sql`
      SELECT id, nickname, delivery_place, status, total_price, created_at
      FROM delivery_orders
      WHERE status NOT IN ('delivered', 'cancelled')
      ORDER BY created_at DESC
      LIMIT 20
    `;

    // Active taxi orders
    const activeTaxi = await sql`
      SELECT id, nickname, status, payment_type, final_price, created_at
      FROM taxi_orders
      WHERE status NOT IN ('delivered', 'cancelled')
      ORDER BY created_at DESC
      LIMIT 20
    `;

    // Today's delivery stats
    const today = new Date().toISOString().slice(0, 10);
    const todayStatsRows = await sql`
      SELECT COUNT(*) as order_count, COALESCE(SUM(total_price), 0) as revenue
      FROM delivery_orders
      WHERE created_at >= ${Date.parse(today)}
        AND status != 'cancelled'
    `;
    const todayStats = todayStatsRows[0] as any;

    // Bot statuses: check env vars are set
    const botStatuses = [
      { id: 1, name: 'Сотрудники (Группа 1)', endpoint: '/api/vk-callback',   configured: !!(process.env.VK_GROUP1_TOKEN && process.env.VK_CONFIRMATION_TOKEN) },
      { id: 2, name: 'Доставка (Группа 2)',   endpoint: '/api/vk-callback-2', configured: !!(process.env.VK_GROUP2_TOKEN && process.env.VK_CONFIRMATION_TOKEN2) },
      { id: 3, name: 'Такси (Группа 3)',       endpoint: '/api/vk-callback-3', configured: !!(process.env.VK_GROUP3_TOKEN && process.env.VK_CONFIRMATION_TOKEN3) },
    ];

    return NextResponse.json({
      onlineList,
      employees: employees.length,
      categories: rootCategories.length,
      activeDelivery,
      activeTaxi,
      todayOrders: Number(todayStats?.order_count ?? 0),
      todayRevenue: Number(todayStats?.revenue ?? 0),
      botStatuses,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
