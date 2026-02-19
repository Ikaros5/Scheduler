const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing environment variables')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function createUser() {
    const { data, error } = await supabase.auth.signUp({
        email: 'your_email@example.com',
        password: 'your_password',
        options: {
            data: {
                display_name: 'Your Name'
            }
        }
    })

    if (error) {
        console.error('Error creating user:', error.message)
    } else {
        console.log('User creation initiated for your_email@example.com!')
        console.log('Please check your email to verify the account.')
    }
}

createUser()
