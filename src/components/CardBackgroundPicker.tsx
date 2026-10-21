import { useId, useRef, useState } from 'react';
import { CARD_BACKGROUNDS, DEFAULT_CARD_BACKGROUND, normalizeCardBackground } from '../lib/cardBackgrounds';
import '../styles/card-backgrounds.css';

export default function CardBackgroundPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const preset = CARD_BACKGROUNDS.find((item) => item.image === value);
  const isCustom = !preset && value !== DEFAULT_CARD_BACKGROUND && !!value;
  const valid = !!normalizeCardBackground(value);

  const handleCustomCardClick = () => {
    if (disabled) return;
    setUploadError(null);
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setUploadError('Please select a valid image file (PNG, JPG, WebP, SVG).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image size must be under 5 MB.');
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const { supabase } = await import('../lib/supabase');
      const ext = file.name.split('.').pop() || 'png';
      const fileName = `banner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = `banners/${fileName}`;

      const { error: uploadErr } = await supabase.storage
        .from('uploads')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type || 'image/jpeg',
        });

      if (uploadErr) {
        throw new Error(uploadErr.message);
      }

      const { data: urlData } = supabase.storage
        .from('uploads')
        .getPublicUrl(filePath);

      if (urlData?.publicUrl) {
        onChange(urlData.publicUrl);
      }
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload image. Please enter an HTTPS URL below.');
    } finally {
      setUploading(false);
      if (event.target) event.target.value = '';
    }
  };

  return (
    <fieldset className="card-background-picker" disabled={disabled}>
      <legend className="label">Coupon card background</legend>
      <p className="background-help">
        Choose a brand design or add your own custom background image. Artwork does not change the coupon issuer or terms.
      </p>

      {/* Hidden file input for custom background image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        style={{ display: 'none' }}
        onChange={handleFileChange}
        disabled={disabled || uploading}
      />

      <div className="background-preset-grid" role="group" aria-label="Predefined card backgrounds">
        {CARD_BACKGROUNDS.map((item) => (
          <button
            type="button"
            key={item.slug}
            className="background-preset"
            aria-label={`Use ${item.name} background`}
            aria-pressed={value === item.image}
            onClick={() => onChange(item.image)}
          >
            <img src={item.image} alt="" loading="lazy" width={160} height={80} />
            <span>{item.name}</span>
          </button>
        ))}

        {/* Plus Banner Card for Custom Background */}
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          className={`background-preset background-preset-plus ${isCustom ? 'is-active' : ''}`}
          aria-label="Add custom background image"
          aria-pressed={isCustom}
          onClick={handleCustomCardClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCustomCardClick();
            }
          }}
        >
          <div className="background-preset-plus-inner">
            {isCustom && valid ? (
              <div
                className="background-preset-plus-preview"
                style={{ backgroundImage: `url(${JSON.stringify(value)})` }}
              >
                <div className="background-preset-plus-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  <span>Custom Active</span>
                </div>
              </div>
            ) : (
              <div className="background-preset-plus-empty">
                <div className="plus-icon-circle">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </div>
                <span className="plus-action-text">{uploading ? 'Uploading…' : 'Add Custom Image'}</span>
                <span className="plus-sub-text">Upload or URL</span>
              </div>
            )}
          </div>
          <span className="background-preset-label">
            {isCustom ? '✓ Custom Artwork' : '+ Custom Background'}
          </span>
        </div>
      </div>

      <p className="background-help" role="status">
        Selected: {preset?.name ?? (value === DEFAULT_CARD_BACKGROUND ? 'Default image' : 'Custom image')}
      </p>

      {uploadError && (
        <p className="background-help" style={{ color: 'var(--red, #ef4444)' }} role="alert">
          {uploadError}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.4rem', marginBottom: '0.2rem' }}>
        <label className="label" htmlFor={inputId} style={{ margin: 0 }}>
          Custom image URL
        </label>
        <span
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          style={{
            fontSize: '0.78rem',
            color: 'var(--cyan, #38bdf8)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            fontWeight: 600,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          Upload from device
        </span>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        className="input"
        type="text"
        inputMode="url"
        placeholder="https://images.unsplash.com/... or paste image URL"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={!valid}
        aria-describedby={`${inputId}-help`}
      />
      <p id={`${inputId}-help`} className="background-help">
        {valid
          ? 'Use an HTTPS image URL, upload a file, or choose one of the bundled designs above.'
          : 'Choose a design or enter a valid HTTPS image URL.'}
      </p>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => onChange(DEFAULT_CARD_BACKGROUND)}
      >
        Use default image
      </button>
    </fieldset>
  );
}
