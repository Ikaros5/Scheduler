import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!url || !key) {
        if (typeof window !== 'undefined') {
            console.warn("Supabase credentials missing. Sign-in and database features will not work.")
        }
        // Return a dummy client or handle it in the UI
        // For now, we'll return the call but it will likely fail silently or throw later
        // Better to return the client call but ensure values aren't '!' to avoid the crash here
        return createBrowserClient(
            url || 'https://placeholder.supabase.co',
            key || 'placeholder-key'
        )
    }

    return createBrowserClient(url, key)
}
