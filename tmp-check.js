const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const envFilePath = path.resolve('.env.local');
const envRaw = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
const envValues = Object.fromEntries(envRaw.split(/\r?\n/).filter(Boolean).map((line) => {
  const idx = line.indexOf('=');
  if (idx === -1) return null;
  const key = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();
  return [key, value];
}).filter(Boolean));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envValues.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || envValues.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
console.log('url', supabaseUrl ? 'set' : 'missing');
console.log('key', supabaseKey ? 'set' : 'missing');
const supabase = createClient(supabaseUrl, supabaseKey);
(async () => {
  const { data, error } = await supabase.from('clinics').select('clinic_type').limit(100);
  console.log(JSON.stringify({ error, data }, null, 2));
})();
