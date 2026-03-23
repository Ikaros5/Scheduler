import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { userId } = body;

        if (!userId) {
            return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
        }

        const supabase = await createClient();

        // Verify the caller is the admin
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || user.email !== 'admin@dnd.com') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        // Use SERVICE ROLE for database access to bypass user-specific RLS
        const serviceClient = createServiceClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        webpush.setVapidDetails(
            'mailto:support@example.com',
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
            process.env.VAPID_PRIVATE_KEY!
        );

        const { data: subRow, error: subError } = await serviceClient
            .from('push_subscriptions')
            .select('subscription')
            .eq('user_id', userId)
            .maybeSingle();

        if (subError) {
            console.error("DB error fetching subscription:", subError);
            throw subError;
        }

        if (!subRow) {
            return NextResponse.json({ success: false, error: 'User has no push subscription — they may not have allowed notifications yet.' }, { status: 404 });
        }

        await webpush.sendNotification(
            subRow.subscription,
            JSON.stringify({
                title: '📅 Schedule Reminder',
                body: 'The DM is asking you to update your availability. Please open the app and check your schedule!',
                icon: '/icon.png'
            })
        );

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('notify-user failed:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
