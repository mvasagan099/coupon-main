import { useId } from 'react';
import { CARD_BACKGROUNDS, DEFAULT_CARD_BACKGROUND, normalizeCardBackground } from '../lib/cardBackgrounds';
import '../styles/card-backgrounds.css';

export default function CardBackgroundPicker({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const inputId = useId();
  const preset = CARD_BACKGROUNDS.find(item => item.image === value);
  const valid = !!normalizeCardBackground(value);
  return <fieldset className="card-background-picker" disabled={disabled}>
    <legend className="label">Coupon card background</legend>
    <p className="background-help">Choose a brand design or paste your own image URL. Artwork does not change the coupon issuer or terms.</p>
    <div className="background-preset-grid" role="group" aria-label="Predefined card backgrounds">
      {CARD_BACKGROUNDS.map(item => <button type="button" key={item.slug} className="background-preset" aria-label={`Use ${item.name} background`} aria-pressed={value === item.image} onClick={() => onChange(item.image)}>
        <img src={item.image} alt="" loading="lazy" width={160} height={80} /><span>{item.name}</span>
      </button>)}
    </div>
    <p className="background-help" role="status">Selected: {preset?.name ?? (value === DEFAULT_CARD_BACKGROUND ? 'Default image' : 'Custom image')}</p>
    <label className="label" htmlFor={inputId}>Custom image URL</label>
    <input id={inputId} className="input" type="text" inputMode="url" value={value} onChange={event => onChange(event.target.value)} aria-invalid={!valid} aria-describedby={`${inputId}-help`} />
    <p id={`${inputId}-help`} className="background-help">{valid ? 'Use an HTTPS image URL, or one of the bundled designs above.' : 'Choose a design or enter a valid HTTPS image URL.'}</p>
    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange(DEFAULT_CARD_BACKGROUND)}>Use default image</button>
  </fieldset>;
}
