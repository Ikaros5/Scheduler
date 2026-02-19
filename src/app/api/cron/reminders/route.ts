import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export async function GET(request: Request) {
    // Basic security check (a secret URL parameter or Authorization header)
    const { searchParams } = new URL(request.url);
    const cronSecret = searchParams.get('secret');

    // Make sure process.env.CRON_SECRET is set in deployment
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    webpush.setVapidDetails(
        'mailto:support@example.com',
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
        process.env.VAPID_PRIVATE_KEY!
    );

    // Go back to the most recent Sunday at 19:00 locally
    const now = new Date();
    const lastSunday = new Date(now);
    lastSunday.setDate(lastSunday.getDate() - lastSunday.getDay()); // Go to Sunday
    lastSunday.setHours(19, 0, 0, 0); // Set to 19:00:00

    // If today is prior to Sunday 19:00, then the cutoff is from the previous week's Sunday
    if (now < lastSunday) {
        lastSunday.setDate(lastSunday.getDate() - 7);
    }

    try {
        const { data: users, error } = await supabase.rpc('get_inactive_users_push_subs', {
            cutoff_time: lastSunday.toISOString()
        });

        if (error) throw error;

        let sentCount = 0;
        let failedCount = 0;

        for (const user of (users || [])) {
            try {
                await webpush.sendNotification(
                    user.subscription,
                    JSON.stringify({
                        title: "Schedule Reminder",
                        body: "Don't forget to log in and update your availability for next week!",
                        icon: "/icon.png"
                    })
                );
                sentCount++;
            } catch (err: any) {
                console.error(`Failed to send to ${user.email}`, err);
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await supabase.from('push_subscriptions').delete().eq('user_id', user.user_id);
                }
                failedCount++;
            }
        }

        return NextResponse.json({ success: true, sentCount, failedCount, cutoff: lastSunday.toISOString() });
    } catch (err: any) {
        console.error("Cron failed:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
