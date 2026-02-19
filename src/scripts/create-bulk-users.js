const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing environment variables')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

const users = [
    { name: 'User1', email: 'user1@example.com' },
    { name: 'User2', email: 'user2@example.com' },
    { name: 'User3', email: 'user3@example.com' },
    { name: 'User4', email: 'user4@example.com' }
];

async function createUsers() {
    for (const user of users) {
        const password = user.name + '123';
        const { data, error } = await supabase.auth.signUp({
            email: user.email,
            password: password,
            options: {
                data: {
                    display_name: user.name
                }
            }
        });

        if (error) {
            console.error(`Error creating user ${user.name}:`, error.message);
        } else {
            console.log(`User creation initiated for ${user.name} (${user.email})!`);
        }
        // Small delay to avoid immediate rate limit
        await new Promise(r => setTimeout(r, 1000));
    }
    console.log('Finished processing missing users.');
}

createUsers();
