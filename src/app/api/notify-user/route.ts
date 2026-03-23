import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
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

        webpush.setVapidDetails(
            'mailto:support@example.com',
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
            process.env.VAPID_PRIVATE_KEY!
        );

        const { data: subRow } = await supabase
            .from('push_subscriptions')
            .select('subscription')
            .eq('user_id', userId)
            .single();

        if (!subRow) {
            return NextResponse.json({ success: false, message: 'User has no push subscription' });
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
