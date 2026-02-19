import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { groupId } = body;

        if (!groupId) {
            return NextResponse.json({ error: 'Group ID is required' }, { status: 400 });
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!; // We use anon key but since it's server side we could use anon, but we'll manually query
        const supabase = createClient(supabaseUrl, supabaseKey);

        webpush.setVapidDetails(
            'mailto:support@example.com',
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
            process.env.VAPID_PRIVATE_KEY!
        );

        // Fetch all users in the specified group
        const { data: groupMembers, error: membersError } = await supabase
            .from('group_members')
            .select('user_id')
            .eq('group_id', groupId);

        if (membersError) throw membersError;

        if (!groupMembers || groupMembers.length === 0) {
            return NextResponse.json({ success: true, sentCount: 0, message: 'No members in group' });
        }

        const userIds = groupMembers.map((m: any) => m.user_id);

        // Fetch subscriptions for these users
        const { data: subscriptions, error: subsError } = await supabase
            .from('push_subscriptions')
            .select('user_id, subscription')
            .in('user_id', userIds);

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
                        title: "Scheduler Update",
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
