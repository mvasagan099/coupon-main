const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ghoiannrniscrxedyzws.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdob2lhbm5ybmlzY3J4ZWR5endzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNDg1MzQsImV4cCI6MjA5MzYyNDUzNH0.kPScuNzI3ezfVWcxJ4jeXbJn46OuY2doy0XhK_NLjxo';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🌱 Creating test coupons in Supabase database...');

  // Create India Coupon
  const { data: inCoupon, error: inErr } = await supabase
    .from('coupons')
    .insert([
      {
        code: 'SVE-INDIA-TEST1',
        amount: 50.00,
        remaining_balance: 50.00,
        country_code: 'IN',
        status: 'ACTIVE',
        is_used: false,
      }
    ])
    .select();

  if (inErr) console.error('Error creating India coupon:', inErr.message);
  else console.log('✅ Created India Coupon:', inCoupon[0]);

  // Create US Coupon
  const { data: usCoupon, error: usErr } = await supabase
    .from('coupons')
    .insert([
      {
        code: 'SVE-USA-TEST1',
        amount: 50.00,
        remaining_balance: 50.00,
        country_code: 'US',
        status: 'ACTIVE',
        is_used: false,
      }
    ])
    .select();

  if (usErr) console.error('Error creating US coupon:', usErr.message);
  else console.log('✅ Created US Coupon:', usCoupon[0]);
}

main();
