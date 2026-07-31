import type { PropsWithChildren } from 'react';

/**
 * GlassCard — Frosted-glass wrapper using the `.glass-card-strong` utility.
 *
 * Variants:
 *  - "strong" (default) — bold blur + bright border
 *  - "glow"  — tinted border glow + hover lift
 *  - "base"  — lightweight glass card (no blur)
 */
interface GlassCardProps extends PropsWithChildren {
  variant?: 'strong' | 'glow' | 'base';
  className?: string;
  style?: React.CSSProperties;
  lift?: boolean;
}

const variantMap: Record<NonNullable<GlassCardProps['variant']>, string> = {
  strong: 'glass-card-strong',
  glow: 'glass-card-glow',
  base: 'glass-card',
};

export function GlassCard({
  children,
  variant = 'strong',
  className = '',
  style,
  lift = false,
}: GlassCardProps) {
  const classes = [variantMap[variant], lift ? 'card-lift' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} style={style}>
      {children}
    </div>
  );
}

/**
 * DashboardCard — Bento-grid stat card with icon, title, and value.
 * Uses the GlassCard wrapper + `.stat-icon-circle` variant.
 */
interface DashboardCardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  variant?: 'primary' | 'emerald' | 'violet' | 'amber';
  className?: string;
  style?: React.CSSProperties;
}

export function DashboardCard({
  title,
  value,
  icon,
  variant = 'primary',
  className = '',
  style,
}: DashboardCardProps) {
  return (
    <div className={`bento-card ${className}`} style={{ display: 'flex', alignItems: 'center', gap: '1rem', ...style }}>
      {icon && (
        <div className={`stat-icon-circle stat-icon-circle--${variant}`} style={{ position: 'relative', zIndex: 1 }}>
          {icon}
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div className="section-label" style={{ marginBottom: '0.25rem' }}>{title}</div>
        <div style={{ fontSize: '1.55rem', fontWeight: 800, letterSpacing: '0.02em', wordSpacing: '0.08em', lineHeight: 1.1 }}>{value}</div>
      </div>
    </div>
  );
}

/**
 * AuroraLayout — Full-screen aurora gradient background for landing/login pages.
 * Renders children centered inside the aurora background.
 */
interface AuroraLayoutProps extends PropsWithChildren {
  className?: string;
  style?: React.CSSProperties;
  animate?: boolean; // enable animated gradient (uses @keyframes aurora)
}

export function AuroraLayout({
  children,
  className = '',
  style,
  animate = false,
}: AuroraLayoutProps) {
  return (
    <div
      className={`aurora-bg min-h-screen flex items-center justify-center ${animate ? 'aurora-bg--animated' : ''} ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

export default GlassCard;
