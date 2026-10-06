import { Link } from 'react-router-dom';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full bg-[#030712] text-slate-300 py-12 md:py-16 mt-auto border-t border-slate-800 relative overflow-hidden" role="contentinfo">
      {/* Decorative Glows */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 pointer-events-none" />
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl -translate-y-1/2 pointer-events-none" />
      
      <div className="max-w-[1400px] mx-auto px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12 lg:gap-8 mb-16">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center justify-center font-extrabold text-white no-underline w-10 h-10 rounded-xl shrink-0 transition-transform hover:scale-105 shadow-glow" style={{ background: 'var(--gradient-primary)' }}>C</div>
              <div>
                <h3 className="text-xl font-bold text-white m-0 tracking-tight">CouponVault</h3>
              </div>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed max-w-sm mb-8">
              Premium digital gifting made simple. Launch campaigns, reward customers, and manage settlements all from one unified platform.
            </p>
            <div className="flex items-center gap-4">
              <a href="#" aria-label="Twitter" className="text-slate-500 hover:text-white transition-colors hover:-translate-y-1 duration-300">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2s9 5 20 5a9.5 9.5 0 00-9-5.5c4.75 2.25 7-7 7-7a4.48 4.48 0 01-1.3-3c0-1.5 1-3 3-3"/>
                </svg>
              </a>
              <a href="#" aria-label="LinkedIn" className="text-slate-500 hover:text-white transition-colors hover:-translate-y-1 duration-300">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z"/>
                  <circle cx="4" cy="4" r="2"/>
                </svg>
              </a>
              <a href="#" aria-label="Facebook" className="text-slate-500 hover:text-white transition-colors hover:-translate-y-1 duration-300">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18 2h-3a6 6 0 00-6 6v3H7v4h2v8h4v-8h3l1-4h-4V8a1 1 0 011-1h3z"/>
                </svg>
              </a>
              <a href="#" aria-label="Instagram" className="text-slate-500 hover:text-white transition-colors hover:-translate-y-1 duration-300">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                  <path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/>
                  <circle cx="17.5" cy="6.5" r="1.5"/>
                </svg>
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-6 tracking-wide text-sm uppercase">Product</h4>
            <ul className="flex flex-col gap-3">
              <li><Link to="/" className="text-slate-400 hover:text-[var(--primary-container)] text-sm transition-colors duration-300 inline-flex items-center gap-2 group"><span>Marketplace</span></Link></li>
              <li><a href="#features" className="text-slate-400 hover:text-[var(--primary-container)] text-sm transition-colors duration-300 inline-flex items-center gap-2 group"><span>Features</span></a></li>
              <li><a href="#pricing" className="text-slate-400 hover:text-[var(--primary-container)] text-sm transition-colors duration-300 inline-flex items-center gap-2 group"><span>Pricing</span></a></li>
              <li><a href="#merchants" className="text-slate-400 hover:text-[var(--primary-container)] text-sm transition-colors duration-300 inline-flex items-center gap-2 group"><span>For Merchants</span></a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-6 tracking-wide text-sm uppercase">Company</h4>
            <ul className="flex flex-col gap-3">
              <li><a href="#about" className="text-slate-400 hover:text-white text-sm transition-colors duration-300">About us</a></li>
              <li><a href="#blog" className="text-slate-400 hover:text-white text-sm transition-colors duration-300">Blog</a></li>
              <li><a href="#careers" className="text-slate-400 hover:text-white text-sm transition-colors duration-300">Careers</a></li>
              <li><a href="#press" className="text-slate-400 hover:text-white text-sm transition-colors duration-300">Press kit</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-6 tracking-wide text-sm uppercase">Legal</h4>
            <ul className="flex flex-col gap-3">
              <li><a href="#privacy" className="text-slate-400 hover:text-white text-sm transition-colors duration-300">Privacy policy</a></li>
              <li><a href="#terms" className="text-slate-400 hover:text-white text-sm transition-colors duration-300">Terms of service</a></li>
              <li><a href="#cookies" className="text-slate-400 hover:text-white text-sm transition-colors duration-300">Cookie policy</a></li>
              <li><a href="#contact" className="text-slate-400 hover:text-white text-sm transition-colors duration-300">Contact us</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-800/80 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-slate-500 text-sm m-0">
            © {currentYear} CouponVault. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-slate-800/50 text-slate-300 border border-slate-700/50">ISO 27001</span>
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-900/20 text-emerald-400 border border-emerald-800/30">PCI Compliant</span>
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-900/20 text-blue-400 border border-blue-800/30">SOC 2 Type II</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
