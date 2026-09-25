import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://qclkmqgavnxpfbvypxac.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjbGttcWdhdm54cGZidnlweGFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNjk4MDEsImV4cCI6MjEwNTY0NTgwMX0.Tq1XlxqPiptig614VtXV3FXZ9dp3BPEw2cy352hNHPY'

export const supabase = createClient(supabaseUrl, supabaseKey)