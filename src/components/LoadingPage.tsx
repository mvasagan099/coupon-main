import { useState, useEffect } from 'react';

export function LoadingPage({ message = "Loading data..." }: { message?: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Fake progress animation that slows down as it gets closer to 100%
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) {
          clearInterval(interval);
          return 95; // Wait at 95% until the actual load finishes and component unmounts
        }
        // Jump faster at the beginning, slower at the end
        const jump = prev < 50 ? 15 : prev < 80 ? 5 : 2;
        return Math.min(prev + jump, 95);
      });
    }, 150);

    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--bg-1)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '320px',
        maxWidth: '85%'
      }}>
        {/* Animated Brand Logo / Icon */}
        <div style={{
          width: '56px',
          height: '56px',
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '1.5rem',
          boxShadow: '0 8px 30px rgba(0,0,0,0.08)'
        }}>
          <div style={{ fontWeight: 800, fontSize: '1.5rem', color: 'var(--text-1)' }}>C</div>
        </div>

        {/* Message */}
        <div style={{
          marginBottom: '1.25rem',
          fontWeight: 600,
          color: 'var(--text-2)',
          fontSize: '0.95rem',
          letterSpacing: '0.02em'
        }}>
          {message}
        </div>

        {/* Horizontal Progress Bar Track */}
        <div style={{
          width: '100%',
          height: '6px',
          background: 'var(--bg-3)',
          borderRadius: '8px',
          overflow: 'hidden',
          position: 'relative'
        }}>
          {/* Progress Bar Fill */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${progress}%`,
            background: 'var(--primary)',
            borderRadius: '8px',
            transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: '0 0 10px var(--primary)'
          }} />
        </div>
      </div>
    </div>
  );
}
