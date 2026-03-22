import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import webpush from 'web-push';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { groupId } = body;

        if (!groupId) {
            return NextResponse.json({ error: 'Group ID is required' }, { status: 400 });
        }

        const supabase = await createClient();

        webpush.setVapidDetails(
            'mailto:support@example.com',
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
            process.env.VAPID_PRIVATE_KEY!
        );

        // Fetch subscriptions using the secure RPC that verifies the user is actually in this group
        const { data: subscriptions, error: subsError } = await supabase.rpc('get_group_push_subs', {
            target_group_id: groupId
        });

        if (subsError) throw subsError;

        if (!subscriptions || subscriptions.length === 0) {
            return NextResponse.json({ success: true, sentCount: 0, message: 'No active subscriptions in group' });
        }

        let sentCount = 0;
        let failedCount = 0;

        for (const sub of subscriptions) {
            try {
                await webpush.sendNotification(
                    sub.subscription,
                    JSON.stringify({
                        title: "Schedule Update Requested",
                        body: "A group member requested you to update your schedule!",
                        icon: "/icon.png"
                    })
                );
                sentCount++;
            } catch (err: any) {
                console.error(`Failed to send to user ${sub.user_id}`, err);
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await supabase.from('push_subscriptions').delete().eq('user_id', sub.user_id);
                }
                failedCount++;
            }
        }

        return NextResponse.json({ success: true, sentCount, failedCount });
    } catch (err: any) {
        console.error("Group notify failed:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
