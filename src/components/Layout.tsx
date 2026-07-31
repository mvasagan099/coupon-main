import { useEffect, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Sun, Moon, ShoppingBag, Wallet, Activity, CreditCard } from 'lucide-react';

import { useTheme } from '../hooks/useTheme';
import TopNav from './TopNav';
import Footer from './Footer';

interface LayoutProps {
  children?: ReactNode;
}

const customerLinks = [
  { label: 'Marketplace', path: '/dashboard/marketplace', Icon: ShoppingBag },
  { label: 'Wallet',      path: '/dashboard/wallet',      Icon: Wallet },
  { label: 'Activity',    path: '/dashboard/activity',    Icon: Activity },
  { label: 'My Cards',    path: '/dashboard/cards',       Icon: CreditCard },
];

export function Layout({ children }: LayoutProps = {}) {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  const isDashboard =
    location.pathname.startsWith('/dashboard') ||
    location.pathname.startsWith('/merchant') ||
    location.pathname.startsWith('/admin') ||
    location.pathname.startsWith('/my-coupon');

  const currentPortal =
    location.pathname.startsWith('/admin')
      ? 'admin'
      : location.pathname.startsWith('/merchant')
        ? 'merchant'
        : 'customer';

  if (isDashboard) {
    const portalBadgeClass =
      currentPortal === 'admin'
        ? 'badge badge-admin'
        : currentPortal === 'merchant'
          ? 'badge badge-merchant'
          : 'badge badge-customer';

    return (
      <div className="layout-dashboard-root aurora-bg">
        {/* Aurora decorative orbs */}
        <div className="aurora-orb aurora-orb--1" />
        <div className="aurora-orb aurora-orb--2" />
        {/* Skip to main content */}
        <a href="#main-content" className="skip-link">Skip to main content</a>
        
        {/* Static Opaque Header Container */}
        <div className="w-full bg-[var(--surface)] border-b border-[var(--border)] relative z-30 transition-all duration-300">
          <header className="layout-dashboard-header flex flex-row items-center justify-between gap-4 p-4 md:px-8 max-w-[1600px] mx-auto w-full" role="banner">
            <div className="flex items-center gap-3">
              <Link to="/" className="sidebar-brand-mark flex items-center justify-center font-extrabold text-white no-underline w-9 h-9 rounded-xl shrink-0 transition-transform hover:scale-105" style={{ background: currentPortal === 'customer' ? 'var(--gradient-primary)' : currentPortal === 'merchant' ? 'var(--gradient-merchant)' : 'var(--gradient-admin)', boxShadow: 'var(--primary-glow)' }}>C</Link>
              <div className="hidden md:block">
                <h1 className="layout-dashboard-title text-base font-bold m-0" style={{ lineHeight: '1.2' }}>
                  {currentPortal === 'admin'
                    ? 'Operations'
                    : currentPortal === 'merchant'
                      ? 'Workspace'
                      : 'Gift Hub'}
                </h1>
              </div>
            </div>
            
            <div className="flex items-center gap-2 md:gap-4">
              {/* Mobile Actions (Visible only on small screens) */}
              <div className="flex md:hidden items-center gap-2">
                <span className={`${portalBadgeClass} font-bold text-[10px]`}>
                  {currentPortal === 'admin' ? 'Admin' : currentPortal === 'merchant' ? 'Merchant' : 'Customer'}
                </span>
                <button className="theme-toggle p-2 rounded-full hover:bg-[var(--bg-3)] transition-colors" onClick={toggleTheme} aria-label="Toggle theme">
                  {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
                </button>
              </div>

              <TopNav portal={currentPortal as 'customer' | 'merchant' | 'admin'} />

              {/* Desktop Actions */}
              <div className="hidden md:flex items-center gap-3 shrink-0 pl-2 border-l border-[var(--border)]">
                <span className={`${portalBadgeClass} font-bold text-xs`}>
                  {currentPortal === 'admin' ? 'Admin' : currentPortal === 'merchant' ? 'Merchant' : 'Customer'}
                </span>
                <button className="theme-toggle p-2 rounded-full hover:bg-[var(--bg-3)] transition-colors" onClick={toggleTheme} aria-label="Toggle theme">
                  {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
                </button>
              </div>
            </div>
          </header>
        </div>

        <div className="layout-dashboard-shell relative z-[1]">
          <main id="main-content" className="dashboard-content-glass page-fade-in layout-dashboard-content flex-1 p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto w-full" role="main">
            {children ?? <Outlet />}
          </main>
        </div>

        {/* Mobile Bottom Navigation Bar (Customer Portal Only) */}
        {currentPortal === 'customer' && (
          <div className="mobile-bottom-nav md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--surface)]/92 border-t border-[var(--border)] px-4 py-2.5 flex justify-around items-center shadow-[0_-8px_30px_rgb(0,0,0,0.06)] backdrop-blur-xl">
            {customerLinks.map((link, index) => {
              const isActive = index === 0
                ? location.pathname === link.path
                : location.pathname.startsWith(link.path);
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`flex flex-col items-center gap-1 py-1 px-3 rounded-2xl transition-all duration-300 ${
                    isActive ? 'text-[var(--primary)] font-semibold' : 'text-[var(--text-3)]'
                  }`}
                  style={{ flex: 1 }}
                >
                  <link.Icon size={18} className={isActive ? 'scale-110 text-[var(--primary)]' : 'opacity-70'} />
                  <span style={{ fontSize: '10px', fontWeight: isActive ? 600 : 500 }}>{link.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="layout-root">
      {/* Skip to main content – for keyboard/screen reader users */}
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="layout-public-header" role="banner">
        <div className="app-shell layout-public-shell flex justify-between items-center py-4">
          <Link to="/" className="layout-brand flex items-center gap-3">
            <div className="layout-brand-mark w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-lg" style={{ background: 'var(--gradient-primary)' }} aria-hidden="true">C</div>
            <div className="layout-brand-copy flex flex-col">
              <strong className="layout-brand-title text-base md:text-lg">Coupon Vault</strong>
              <span className="layout-brand-subtitle text-xs md:text-sm text-gray-500">Premium digital gifting</span>
            </div>
          </Link>



          <div className="layout-public-actions flex items-center gap-2 md:gap-4">
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <Link className="btn btn-secondary btn-sm hidden sm:inline-flex" to="/userlogin">
              Customer login
            </Link>
            <Link className="btn btn-primary btn-sm" to="/companylogin">
              Company login
            </Link>
          </div>
        </div>
      </header>

      <main id="main-content" className="app-shell layout-public-main" role="main">{children ?? <Outlet />}</main>

      <Footer />
    </div>
  );
}

export default Layout;
