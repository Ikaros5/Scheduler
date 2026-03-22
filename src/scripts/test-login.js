require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testLogin() {
    const users = [
        { email: 'raulmedrei@gmail.com', pass: 'vibecoder' },
        { email: 'lacuevafortitcarlos@gmail.com', pass: 'mainmalphite' },
        { email: 'alazcanomarteau@gmail.com', pass: 'israel' },
        { email: 'epiccsryt@gmail.com', pass: 'tiersplayer' }
    ];

    for (const u of users) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: u.email,
            password: u.pass
        });
        if (error) {
            console.log(`[${u.email}] FAIL: ${error.message} (status: ${error.status} / name: ${error.name})`);
        } else {
            console.log(`[${u.email}] SUCCESS! Tokens received.`);
        }
    }
}

testLogin();
