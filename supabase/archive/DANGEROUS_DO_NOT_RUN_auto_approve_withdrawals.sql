-- SQL Script: Auto-approve withdrawal requests in Supabase
-- This trigger listens for inserts into the `withdrawals` table and automatically sets the status to 'completed'.

CREATE OR REPLACE FUNCTION public.auto_approve_withdrawal()
RETURNS TRIGGER AS $$
BEGIN
  -- Automatically set the status of new withdrawals to 'completed'
  NEW.status := 'completed';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop the trigger if it already exists
DROP TRIGGER IF EXISTS approve_withdrawal_trigger ON public.withdrawals;

-- Bind the trigger BEFORE INSERT
CREATE TRIGGER approve_withdrawal_trigger
BEFORE INSERT ON public.withdrawals
FOR EACH ROW
EXECUTE FUNCTION public.auto_approve_withdrawal();
