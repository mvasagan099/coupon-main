-- ============================================================
-- SECURE USER WITHDRAWALS & ADMIN HELPERS Setup
-- ============================================================

-- 1. Create trigger function to handle withdrawal balance deduction & refund
CREATE OR REPLACE FUNCTION process_withdrawal_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance numeric;
BEGIN
  -- If INSERT: validate balance and deduct
  IF (TG_OP = 'INSERT') THEN
    -- Lock the profile row to prevent race conditions
    SELECT wallet_balance INTO v_current_balance
    FROM public.profiles
    WHERE id = NEW.user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'User profile not found';
    END IF;

    IF NEW.amount <= 0 THEN
      RAISE EXCEPTION 'Withdrawal amount must be positive';
    END IF;

    IF v_current_balance < NEW.amount THEN
      RAISE EXCEPTION 'Insufficient balance for withdrawal: have %, need %', v_current_balance, NEW.amount;
    END IF;

    -- Deduct balance
    UPDATE public.profiles
    SET wallet_balance = wallet_balance - NEW.amount
    WHERE id = NEW.user_id;

    RETURN NEW;

  -- If UPDATE: handle rejection refund
  ELSIF (TG_OP = 'UPDATE') THEN
    -- If status changed to rejected, refund the amount
    IF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
      UPDATE public.profiles
      SET wallet_balance = wallet_balance + OLD.amount
      WHERE id = NEW.user_id;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- Attach trigger to withdrawals table
DROP TRIGGER IF EXISTS handle_withdrawal_balance ON public.withdrawals;
CREATE TRIGGER handle_withdrawal_balance
  BEFORE INSERT OR UPDATE ON public.withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION process_withdrawal_balance();


-- 2. Create the RPC function to get withdrawals with emails for the Admin Dashboard
CREATE OR REPLACE FUNCTION admin_get_withdrawals()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  email text,
  amount numeric,
  routing_number text,
  account_number text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only allow admins to call this
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT 
    w.id,
    w.user_id,
    u.email::text,
    w.amount,
    w.routing_number,
    w.account_number,
    w.status,
    w.created_at
  FROM public.withdrawals w
  JOIN auth.users u ON w.user_id = u.id
  ORDER BY w.created_at DESC;
END;
$$;
