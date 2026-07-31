import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ShoppingBag, Wallet, Activity, CreditCard, LayoutDashboard,
  Users, BookOpen, CheckCircle, UserPlus, Shield, LogOut,
  Layers, BarChart3, Store, Scan, Zap
} from 'lucide-react';

interface TopNavProps {
  portal: 'customer' | 'merchant' | 'admin';
}

interface NavLink { label: string; path: string; Icon: React.ComponentType<{ size?: number; className?: string }> }

const customerLinks: NavLink[] = [
  { label: 'Marketplace', path: '/dashboard/marketplace', Icon: ShoppingBag },
  { label: 'Wallet',      path: '/dashboard/wallet',      Icon: Wallet },
  { label: 'Activity',    path: '/dashboard/activity',    Icon: Activity },
  { label: 'My Cards',    path: '/dashboard/cards',       Icon: CreditCard },
];

const merchantLinks: NavLink[] = [
  { label: 'Overview',    path: '/merchant/overview',     Icon: LayoutDashboard },
  { label: 'Campaigns',   path: '/merchant/campaigns',    Icon: Zap },
  { label: 'Coupons',     path: '/merchant/coupons',      Icon: Layers },
  { label: 'Redemptions', path: '/merchant/redemptions',  Icon: Scan },
  { label: 'Settlements', path: '/merchant/settlements',  Icon: CheckCircle },
  { label: 'Onboarding',  path: '/merchant/onboarding',   Icon: UserPlus },
];

const adminLinks: NavLink[] = [
  { label: 'Overview',    path: '/admin/overview',        Icon: BarChart3 },
  { label: 'Partners',    path: '/admin/partners',        Icon: Store },
  { label: 'Users',       path: '/admin/users',           Icon: Users },
  { label: 'Ledger',      path: '/admin/ledger',          Icon: BookOpen },
  { label: 'Approvals',   path: '/admin/approvals',       Icon: CheckCircle },
  { label: 'Settlements', path: '/admin/settlements',     Icon: CheckCircle },
  { label: 'Payouts',     path: '/admin/payouts',         Icon: Wallet },
  { label: 'Security',    path: '/admin/security',        Icon: Shield },
];

export default function TopNav({ portal }: TopNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [showConfirmSignOut, setShowConfirmSignOut] = useState(false);

  useEffect(() => {
    if (showConfirmSignOut) {
      document.body.style.overflow = 'hidden';
      document.body.classList.add('body-modal-open');
    } else {
      document.body.style.overflow = '';
      document.body.classList.remove('body-modal-open');
    }
    return () => {
      document.body.style.overflow = '';
      document.body.classList.remove('body-modal-open');
    };
  }, [showConfirmSignOut]);

  const links = portal === 'admin' ? adminLinks : portal === 'merchant' ? merchantLinks : customerLinks;

  const handleSignOutClick = () => {
    setShowConfirmSignOut(true);
  };

  const confirmSignOut = async () => {
    setShowConfirmSignOut(false);
    await signOut();
    navigate('/');
  };

  return (
    <nav className="flex items-center gap-1 md:gap-2 overflow-x-auto py-1 no-scrollbar w-full md:w-auto md:justify-center" style={{ scrollbarWidth: 'none' }}>
      {links.map((link, index) => {
        const isActive = index === 0
          ? location.pathname === link.path
          : location.pathname.startsWith(link.path);

        return (
          <Link
            key={`${link.label}-${index}`}
            to={link.path}
            className={`items-center gap-1.5 px-3 py-2 md:px-4 md:py-2 rounded-full whitespace-nowrap text-[13px] md:text-sm font-medium transition-all duration-300 ${
              portal === 'customer' ? 'hidden md:flex' : 'flex'
            } ${
              isActive 
                ? 'bg-[var(--primary)] text-white shadow-[var(--primary-glow)]' 
                : 'text-[var(--text-2)] hover:bg-[var(--bg-3)] hover:text-[var(--text-1)]'
            }`}
          >
            <link.Icon size={16} 
            className={isActive ? 'opacity-100' : 'opacity-70'} />
            <span className="hidden sm:inline">{link.label}</span>
          </Link>
        );
      })}
      
      {/* Mobile Only Sign Out */}
      <div className="md:hidden flex items-center ml-auto pl-2 border-l border-[var(--border)]">
        <button
          className="flex items-center gap-1.5 px-3 py-2 rounded-full whitespace-nowrap text-[13px] font-medium text-[var(--red)] bg-[var(--red-muted)]"
          onClick={handleSignOutClick}
        >
          <LogOut size={14} />
          <span>Sign Out</span>
        </button>
      </div>
      
      {/* Desktop Sign Out inside Layout */}
      <div className="hidden md:flex flex-1 min-w-[0.5rem]" />
      <button
        className="hidden md:flex items-center justify-center shrink-0 rounded-full w-9 h-9 text-[var(--text-3)] hover:text-[var(--red)] hover:bg-[var(--red-muted)] transition-all duration-300"
        onClick={handleSignOutClick}
        title="Sign out"
      >
        <LogOut size={16} />
      </button>

      {showConfirmSignOut && (
        <div className="glass-modal-overlay">
          <div className="glass-modal-panel fade-in" style={{ maxWidth: '360px', textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 0.5rem', color: 'var(--text-1)', fontSize: '1.2rem', fontWeight: 700 }}>Sign Out</h3>
            <p style={{ margin: '0 0 1.5rem', color: 'var(--text-3)', fontSize: '0.9rem' }}>Are you sure you want to sign out of your account?</p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowConfirmSignOut(false)}
                style={{ flex: 1 }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="btn btn-sm"
                onClick={confirmSignOut}
                style={{ flex: 1, background: 'var(--red, #ef4444)', color: 'white', border: 'none', borderRadius: '99px', fontWeight: 600 }}
                type="button"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
