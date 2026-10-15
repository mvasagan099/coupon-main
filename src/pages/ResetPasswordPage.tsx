import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export default function ResetPasswordPage() {
  const { isPasswordRecovery, finishPasswordRecovery } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const recoveryError = new URLSearchParams(window.location.hash.slice(1)).get('error_description') ?? new URLSearchParams(window.location.search).get('error_description');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setMessage('');
    if (!isSupabaseConfigured) { setError('Password recovery is unavailable. Please contact support.'); return; }
    if (isPasswordRecovery && password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      if (isPasswordRecovery) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword(''); setConfirmation('');
        finishPasswordRecovery();
        setMessage('Your password has been updated. You can now continue to your dashboard.');
        window.history.replaceState(null, '', '/reset-password');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        setMessage('If an account exists for this email, a password reset link will arrive shortly. Open the latest link in this browser.');
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Password recovery failed. Please try again.'); }
    finally { setBusy(false); }
  }

  return <section aria-label="Password recovery" style={{ width: 'min(100%, 520px)', margin: '0 auto', padding: '4rem 1rem' }}>
    <div className="glass-card-strong" style={{ padding: '2rem' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.75rem' }}>{isPasswordRecovery ? 'Choose a new password' : 'Reset your password'}</h1>
      <p style={{ marginBottom: '1.5rem', color: 'var(--text-3)' }}>{isPasswordRecovery ? 'Enter and confirm your new password.' : 'Enter your account email to receive a reset link.'}</p>
      {(error || recoveryError) && <p role="alert">{error || `This reset link is invalid or expired. Request a new link. ${recoveryError}`}</p>}
      {message && <p role="status">{message}</p>}
      <form onSubmit={submit} style={{ display: 'grid', gap: '1rem' }}>
        {isPasswordRecovery ? <>
          <label style={{ display: 'grid', gap: '0.5rem' }}>New password<input className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} /></label>
          <label style={{ display: 'grid', gap: '0.5rem' }}>Confirm password<input className="input" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
        </> : <label style={{ display: 'grid', gap: '0.5rem' }}>Email<input className="input" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>}
        <button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Please wait…' : isPasswordRecovery ? 'Save new password' : 'Send reset link'}</button>
      </form>
      <p style={{ marginTop: '1.5rem' }}><Link to="/login">Return to sign in</Link> · <Link to="/dashboard">Dashboard</Link></p>
    </div>
  </section>;
}
