'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function UserActivityTracker() {
    const supabase = createClient();

    useEffect(() => {
        const updateActivity = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                // Update the hidden last_seen_at field on profiles
                await supabase
                    .from('profiles')
                    .update({ last_seen_at: new Date().toISOString() })
                    .eq('id', user.id);
            }
        };

        // Update once on mount (at least once per visit)
        updateActivity();
    }, [supabase]);

    return null;
}
