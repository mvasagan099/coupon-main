import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div
      className="fade-in"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1rem',
        background:
          'radial-gradient(ellipse 80% 50% at 20% 30%, rgba(79,99,245,0.08) 0%, transparent 55%), var(--background)',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: '480px', width: '100%' }}>
        {/* Glow orb behind the number */}
        <div
          style={{
            position: 'relative',
            display: 'inline-block',
            marginBottom: '1.5rem',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '-30px',
              background: 'radial-gradient(circle, rgba(79,99,245,0.18) 0%, transparent 70%)',
              filter: 'blur(20px)',
              borderRadius: '50%',
              pointerEvents: 'none',
            }}
          />
          <span
            style={{
              position: 'relative',
              fontSize: 'clamp(5rem, 16vw, 8rem)',
              fontWeight: 900,
              letterSpacing: '0.02em', wordSpacing: '0.08em',
              lineHeight: 1,
              background: 'linear-gradient(135deg, #4f63f5 0%, #7c3aed 60%, #06b6d4 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              display: 'block',
            }}
          >
            404
          </span>
        </div>

        <div className="glass-card-strong" style={{ padding: '2.5rem 2rem' }}>
          <span className="badge badge-cyan" style={{ marginBottom: '1.25rem' }}>
            Page not found
          </span>
          <h1
            style={{
              margin: '0 0 0.75rem',
              fontSize: '1.65rem',
              fontWeight: 800,
              letterSpacing: '0.02em', wordSpacing: '0.08em',
              color: 'var(--text-1)',
            }}
          >
            This page doesn't exist
          </h1>
          <p
            style={{
              margin: '0 0 2rem',
              color: 'var(--text-3)',
              lineHeight: 1.65,
              fontSize: '0.95rem',
            }}
          >
            The URL you followed may be broken, or the page may have been moved or removed.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/" className="btn btn-primary">
              Return home
            </Link>
            <Link to="/dashboard/marketplace" className="btn btn-secondary">
              Browse marketplace
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
