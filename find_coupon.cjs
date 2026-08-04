const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ghoiannrniscrxedyzws.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdob2lhbm5ybmlzY3J4ZWR5endzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNDg1MzQsImV4cCI6MjA5MzYyNDUzNH0.kPScuNzI3ezfVWcxJ4jeXbJn46OuY2doy0XhK_NLjxo';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🔍 Searching for newly created coupon SVE-SVEDJPCU...');

  const { data: exactMatch, error: err1 } = await supabase
    .from('coupons')
    .select('*')
    .ilike('code', '%SVEDJPCU%');

  console.log('Exact search result:', exactMatch, 'Error:', err1?.message || 'none');

  const { data: allCoupons, error: err2 } = await supabase
    .from('coupons')
    .select('*')
    .limit(50);

  console.log(`Total coupons found in table: ${allCoupons?.length || 0}`);
  if (allCoupons && allCoupons.length > 0) {
    console.table(allCoupons);
  }
}

main();
