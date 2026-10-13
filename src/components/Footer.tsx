import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="bg-slate-950 text-slate-300 py-12 mt-auto border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-6 grid gap-8 md:grid-cols-2">
        <div>
          <h3 className="text-white text-xl font-bold mb-3">CouponVault</h3>
          <p className="text-slate-400 text-sm max-w-md">Digital gifting, merchant campaigns and verified coupon redemption.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-6 md:justify-end items-start">
          <Link to="/#marketplace" className="text-slate-300 hover:text-white">Marketplace</Link>
          <Link to="/#experience" className="text-slate-300 hover:text-white">Features</Link>
          <Link to="/#business" className="text-slate-300 hover:text-white">For merchants</Link>
          <Link to="/userlogin" className="text-slate-300 hover:text-white">Customer portal &amp; support</Link>
        </nav>
        <p className="text-slate-500 text-sm md:col-span-2">© {new Date().getFullYear()} CouponVault. All rights reserved.</p>
      </div>
    </footer>
  );
}
