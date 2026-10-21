import { useRef, useState } from 'react';
import CardBackgroundPicker from './CardBackgroundPicker';
import { DEFAULT_CARD_BACKGROUND, cardBackgroundImage, normalizeCardBackground } from '../lib/cardBackgrounds';
import { updateGiftCardBanner } from '../lib/supabase';
import type { GiftCard } from '../lib/supabase';

export default function CouponBackgroundEditor({ offer, onSaved }: { offer: GiftCard; onSaved: (image: string) => void }) {
  const [image, setImage] = useState(offer.banner_image || DEFAULT_CARD_BACKGROUND);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const saving = useRef(false);
  async function save() {
    if (saving.current) return;
    const normalized = normalizeCardBackground(image);
    if (!normalized) { setError('Choose a design or enter a valid HTTPS image URL.'); return; }
    saving.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await updateGiftCardBanner(offer.id, offer.company_id, offer.banner_image, normalized);
      onSaved(normalized); setImage(normalized); setMessage('Background saved. Customers will see it when they reload the marketplace.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Background was not saved. Please reload and try again.'); }
    finally { saving.current = false; setBusy(false); }
  }
  return <details className="coupon-background-editor"><summary>Change background</summary>
    <CardBackgroundPicker value={image} disabled={busy} onChange={value => { setImage(value); setError(''); setMessage(''); }} />
    <div className="saved-background-preview" role="img" aria-label={`${offer.title} background preview`} style={{ backgroundImage: cardBackgroundImage(image) }}><strong>{offer.title}</strong></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <button type="button" className="btn btn-primary" disabled={busy || !normalizeCardBackground(image) || image === offer.banner_image} onClick={() => void save()}>{busy ? 'Saving…' : 'Save background'}</button>
  </details>;
}
