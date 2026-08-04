const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ghoiannrniscrxedyzws.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdob2lhbm5ybmlzY3J4ZWR5endzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNDg1MzQsImV4cCI6MjA5MzYyNDUzNH0.kPScuNzI3ezfVWcxJ4jeXbJn46OuY2doy0XhK_NLjxo';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🔍 Querying coupons from Supabase database...');
  
  const { data: coupons, error } = await supabase
    .from('coupons')
    .select('id, code, is_used, amount, remaining_balance, status, country_code, issued_to, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('❌ Error fetching coupons:', error);
    return;
  }

  console.log(`📋 Found ${coupons.length} coupons:`);
  console.table(coupons.map(c => ({
    Code: c.code,
    'Country Code': c.country_code || '(None - Universal)',
    'Amount': c.amount || c.remaining_balance,
    'Used?': c.is_used,
    'Status': c.status,
  })));
}

main();
