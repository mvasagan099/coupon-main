CREATE TABLE IF NOT EXISTS withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL CHECK (amount > 0),
    routing_number TEXT NOT NULL,
    account_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_view_own_withdrawals" 
ON withdrawals 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "user_insert_own_withdrawals" 
ON withdrawals 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "admin_all_withdrawals" 
ON withdrawals 
FOR ALL 
USING (is_admin());
