import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing environment variables for Supabase.')
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // Get the JWT from the request header to verify the caller is an Admin
    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    
    if (authError || !user) {
      throw new Error('Unauthorized')
    }

    // Verify caller is an Admin by checking their profile role
    const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'Admin') {
      throw new Error('Forbidden: Only Admins can provision new users.')
    }

    // Parse the request
    const { email, name, organization, role } = await req.json()
    if (!email || !role) {
      throw new Error('Email and Role are required.')
    }

    // Create the user via the admin api using createUser
    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { name, organization, role, status: 'Pending' }
    })

    if (createError) {
      throw createError
    }

    const newUserId = userData.user.id

    // Generate secure invite link
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email: email,
    })

    if (linkError) {
      console.error('Failed to generate invite link:', linkError)
      // We don't throw here to ensure the profile is still created
    }

    // Create Profile Row
    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: newUserId,
      email,
      name,
      organization,
      role,
      status: 'Pending',
      invited_at: new Date().toISOString(),
      invited_by: user.id
    })

    if (profileError) throw profileError

    // Create User Settings Row
    await supabaseAdmin.from('user_settings').insert({
      user_id: newUserId,
      email_notifications: true
    }).catch(() => {})

    // Audit Log
    await supabaseAdmin.from('audit_logs').insert({
      user_id: user.id,
      action: 'USER_INVITED',
      metadata: { target_user_id: newUserId, email, role }
    })

    return new Response(JSON.stringify({ 
      user: userData.user,
      invite_link: linkData?.properties?.action_link 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
