// src/components/CountrySelector.tsx
// Searchable country dropdown with flag emoji, currency, and phone code display.
// Emits a full CountryInfo object on selection.

import { useState, useRef, useEffect } from 'react';
import { COUNTRIES, searchCountries, type CountryInfo } from '../lib/countries';

interface CountrySelectorProps {
  value?: string | null;         // ISO alpha-2 code of currently selected country
  onChange: (country: CountryInfo) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  placeholder?: string;
}

export default function CountrySelector({
  value,
  onChange,
  disabled = false,
  required = false,
  id = 'country-selector',
  placeholder = 'Search country…',
}: CountrySelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef  = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = value ? COUNTRIES.find((c) => c.code === value) ?? null : null;
  const filtered = searchCountries(query);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus input when dropdown opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  function handleSelect(country: CountryInfo) {
    onChange(country);
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', zIndex: open ? 9999 : 1 }} id={id}>
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width:          '100%',
          display:        'flex',
          alignItems:     'center',
          gap:            '0.6rem',
          padding:        '0.65rem 0.9rem',
          borderRadius:   '12px',
          border:         `1.5px solid ${open ? 'var(--accent)' : 'var(--border)'}`,
          background:     'var(--surface-soft)',
          cursor:         disabled ? 'not-allowed' : 'pointer',
          textAlign:      'left',
          transition:     'border-color 0.18s',
          boxShadow:      open ? '0 0 0 3px var(--accent-muted)' : 'none',
          color:          'var(--text-1)',
          fontSize:       '0.92rem',
          opacity:        disabled ? 0.6 : 1,
        }}
      >
        {selected ? (
          <>
            <span style={{ fontSize: '1.3rem', lineHeight: 1 }}>{selected.flag}</span>
            <span style={{ flex: 1, fontWeight: 500 }}>{selected.name}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', background: 'var(--surface)', padding: '0.15rem 0.45rem', borderRadius: '6px', fontWeight: 600 }}>
              {selected.currency}
            </span>
            <span style={{ color: 'var(--text-3)', fontSize: '0.8rem' }}>▾</span>
          </>
        ) : (
          <>
            <span style={{ flex: 1, color: 'var(--text-3)' }}>Select your country</span>
            <span style={{ color: 'var(--text-3)', fontSize: '0.8rem' }}>▾</span>
          </>
        )}
      </button>

      {/* Hidden required input for form validation */}
      {required && (
        <input
          type="text"
          tabIndex={-1}
          required
          value={selected?.code ?? ''}
          onChange={() => {}}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
          aria-hidden="true"
        />
      )}

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          aria-label="Select country"
          style={{
            position:     'absolute',
            top:          'calc(100% + 6px)',
            left:         0,
            right:        0,
            zIndex:       9999,
            background:   'var(--surface)',
            border:       '1.5px solid var(--border)',
            borderRadius: '14px',
            boxShadow:    '0 12px 40px rgba(0,0,0,0.22)',
            overflow:     'hidden',
            animation:    'fadeIn 0.12s ease',
          }}
        >
          {/* Search input */}
          <div style={{ padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: '0.9rem' }}>🔍</span>
              <input
                ref={inputRef}
                type="text"
                placeholder={placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{
                  width:          '100%',
                  boxSizing:      'border-box',
                  padding:        '0.5rem 0.6rem 0.5rem 2rem',
                  borderRadius:   '9px',
                  border:         '1.5px solid var(--border)',
                  background:     'var(--surface-soft)',
                  color:          'var(--text-1)',
                  fontSize:       '0.88rem',
                  outline:        'none',
                }}
              />
            </div>
          </div>

          {/* Country list */}
          <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '0.88rem' }}>
                No countries found
              </div>
            ) : (
              filtered.map((country) => {
                const isSel = country.code === selected?.code;
                return (
                  <button
                    key={country.code}
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    onClick={() => handleSelect(country)}
                    style={{
                      display:        'flex',
                      alignItems:     'center',
                      gap:            '0.6rem',
                      width:          '100%',
                      padding:        '0.6rem 0.85rem',
                      border:         'none',
                      background:     isSel ? 'var(--accent-muted)' : 'transparent',
                      cursor:         'pointer',
                      textAlign:      'left',
                      color:          isSel ? 'var(--accent)' : 'var(--text-1)',
                      fontSize:       '0.88rem',
                      transition:     'background 0.12s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSel) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-soft)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSel) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    }}
                  >
                    <span style={{ fontSize: '1.2rem', lineHeight: 1, flexShrink: 0 }}>{country.flag}</span>
                    <span style={{ flex: 1, fontWeight: 500 }}>{country.name}</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', fontWeight: 600, flexShrink: 0 }}>
                      {country.currency}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', flexShrink: 0, minWidth: '2.8rem', textAlign: 'right' }}>
                      {country.phoneCode}
                    </span>
                    {isSel && (
                      <span style={{ color: 'var(--accent)', fontSize: '0.85rem', flexShrink: 0 }}>✓</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
