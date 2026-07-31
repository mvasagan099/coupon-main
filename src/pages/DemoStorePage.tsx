import { useState } from 'react';
import { validateCoupon, redeemCouponAmount } from '../lib/supabase';
import type { CouponValidation } from '../lib/supabase';

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  image: string;
  description: string;
}

const PRODUCTS: Product[] = [
  {
    id: 'p0',
    name: 'Acoustic Ear Tips',
    category: 'Accessories',
    price: 100,
    image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&auto=format&fit=crop&q=80',
    description: 'Premium memory foam ear tips for ultimate comfort and sound isolation.',
  },
  {
    id: 'p1',
    name: 'Braided Audio Cable',
    category: 'Accessories',
    price: 450,
    image: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=800&auto=format&fit=crop&q=80',
    description: 'High-fidelity braided aux cable designed to reduce tangles and audio interference.',
  },
  {
    id: 'p2',
    name: 'SonicMax Earbuds',
    category: 'True Wireless',
    price: 1500,
    image: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&auto=format&fit=crop&q=80',
    description: 'Compact wireless earbuds with rich bass and 24-hour battery life.',
  },
  {
    id: 'p3',
    name: 'Acoustic Go Speaker',
    category: 'Portable Audio',
    price: 2000,
    image: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=800&auto=format&fit=crop&q=80',
    description: 'Waterproof bluetooth speaker for all your adventures.',
  },
  {
    id: 'p4',
    name: 'SonicMax Pro',
    category: 'Headphones',
    price: 2500,
    image: 'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=800&auto=format&fit=crop&q=80',
    description: 'Active noise cancellation meets studio-quality audio.',
  },
  {
    id: 'p5',
    name: 'Studio Monitor Stand',
    category: 'Accessories',
    price: 3500,
    image: 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=800&auto=format&fit=crop&q=80',
    description: 'Professional desktop monitor stands designed for optimal acoustic positioning.',
  },
  {
    id: 'p6',
    name: 'Vintage Turntable',
    category: 'Analog Audio',
    price: 6000,
    image: 'https://images.unsplash.com/photo-1531104985437-602d73af45dd?w=800&auto=format&fit=crop&q=80',
    description: 'Belt-drive record player with built-in preamp and premium aesthetic.',
  },
  {
    id: 'p7',
    name: 'Acoustic Surround System',
    category: 'Home Theater',
    price: 10000,
    image: 'https://images.unsplash.com/photo-1558231872-9cb773b0a790?w=800&auto=format&fit=crop&q=80',
    description: 'Immersive 5.1 channel surround sound system bringing the cinema experience home.',
  }
];

export default function DemoStorePage() {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<CouponValidation | null>(null);
  const [couponError, setCouponError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkoutState, setCheckoutState] = useState<'idle' | 'processing' | 'success'>('idle');
  const [activeCategory, setActiveCategory] = useState<string>('Shop All');

  const filteredProducts = PRODUCTS.filter(p => {
    if (activeCategory === 'Shop All') return true;
    if (activeCategory === 'Accessories') return p.category === 'Accessories';
    if (activeCategory === 'Audio') return p.category !== 'Accessories';
    return true;
  });

  const discountAmount = appliedCoupon && selectedProduct 
    ? Math.min(selectedProduct.price, appliedCoupon.remaining_balance || 0) 
    : 0;
  const finalTotal = selectedProduct ? selectedProduct.price - discountAmount : 0;

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    
    setLoading(true);
    setCouponError('');
    try {
      const validation = await validateCoupon(couponCode);
      
      if (validation.status === 'redeemed' || validation.is_used) {
        throw new Error('This voucher has already been fully redeemed.');
      }
      if (validation.status === 'expired') {
        throw new Error('This voucher has expired.');
      }
      if ((validation.remaining_balance || 0) <= 0) {
        throw new Error('This voucher has no remaining balance.');
      }
      
      setAppliedCoupon(validation);
      setCouponCode('');
    } catch (err: unknown) {
      setCouponError(err instanceof Error ? err.message : 'Invalid coupon code');
      setAppliedCoupon(null);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponError('');
  };

  const handleCheckout = async () => {
    setCheckoutState('processing');
    
    try {
      if (appliedCoupon && discountAmount > 0) {
        await redeemCouponAmount(appliedCoupon.coupon_id, discountAmount);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      setCheckoutState('success');
    } catch (err: unknown) {
      alert(`Checkout failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setCheckoutState('idle');
    }
  };

  const resetStore = () => {
    setCheckoutState('idle');
    setSelectedProduct(null);
    setAppliedCoupon(null);
    setCouponCode('');
    setActiveCategory('Shop All');
  };

  if (checkoutState === 'success') {
    return (
      <div style={{ minHeight: '100vh', background: '#fafafa', fontFamily: '"Inter", -apple-system, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: 'white', padding: '4rem', borderRadius: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.04)', textAlign: 'center', maxWidth: '480px', width: '100%' }}>
          <div style={{ width: '80px', height: '80px', background: '#000', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem', color: '#fff' }}>
            <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 style={{ margin: '0 0 1rem', color: '#000', fontSize: '2rem', fontWeight: 800, letterSpacing: '0.02em', wordSpacing: '0.08em', }}>Order Confirmed</h2>
          <p style={{ color: '#666', lineHeight: '1.6', margin: '0 0 2.5rem', fontSize: '1.125rem' }}>
            Thank you for purchasing the {selectedProduct?.name}. It will be shipped shortly.
          </p>
          {appliedCoupon && (
            <div style={{ background: '#f5f5f7', padding: '1.5rem', borderRadius: '16px', marginBottom: '2.5rem', textAlign: 'left' }}>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Gift Card Applied</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#000', fontSize: '1.125rem' }}>
                <span style={{ fontFamily: 'monospace' }}>{appliedCoupon.coupon_code}</span>
                <span>-₹{discountAmount.toFixed(2)}</span>
              </div>
            </div>
          )}
          <button onClick={resetStore} style={{ display: 'inline-block', background: '#000', color: 'white', border: 'none', padding: '1rem 2rem', borderRadius: '99px', fontWeight: 600, fontSize: '1.125rem', cursor: 'pointer', transition: 'transform 0.2s', width: '100%' }}>
            Continue Shopping
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#fff', fontFamily: '"Inter", -apple-system, sans-serif', color: '#111' }}>
      <style>{`
        .checkout-layout {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 6rem;
          align-items: start;
        }
        .store-header {
          position: sticky;
          top: 0;
          z-index: 100;
          background: rgba(255, 255, 255, 0.8);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(0,0,0,0.05);
          padding: 1.25rem 2rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 1rem;
        }
        .store-nav {
          display: flex;
          gap: 2rem;
          font-weight: 500;
          font-size: 0.9rem;
          color: #666;
          flex-wrap: wrap;
          justify-content: center;
        }
        @media (max-width: 900px) {
          .checkout-layout {
            grid-template-columns: 1fr;
            gap: 3rem;
          }
        }
        @media (max-width: 600px) {
          .store-header {
            flex-direction: column;
            text-align: center;
          }
          .store-nav {
            gap: 1rem;
          }
        }
      `}</style>

      {/* Premium Header */}
      <header className="store-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }} onClick={resetStore}>
          <div style={{ width: '32px', height: '32px', background: '#000', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 900, fontSize: '1.25rem' }}>A</div>
          <span style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '0.02em', wordSpacing: '0.08em', }}>ACME.</span>
        </div>
        <nav className="store-nav">
          <span style={{ color: activeCategory === 'Shop All' ? '#000' : '#666', cursor: 'pointer' }} onClick={() => { setActiveCategory('Shop All'); setSelectedProduct(null); }}>Shop All</span>
          <span style={{ color: activeCategory === 'Audio' ? '#000' : '#666', cursor: 'pointer' }} onClick={() => { setActiveCategory('Audio'); setSelectedProduct(null); }}>Audio</span>
          <span style={{ color: activeCategory === 'Accessories' ? '#000' : '#666', cursor: 'pointer' }} onClick={() => { setActiveCategory('Accessories'); setSelectedProduct(null); }}>Accessories</span>
          <span style={{ cursor: 'pointer' }} onClick={() => alert('Support portal is currently offline for maintenance.')}>Support</span>
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => {
            if (!selectedProduct) alert('Your cart is empty. Please select a product first.');
          }}>
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
            {selectedProduct && <div style={{ position: 'absolute', top: '-5px', right: '-8px', background: '#e11d48', color: 'white', width: '18px', height: '18px', borderRadius: '50%', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>1</div>}
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '1200px', margin: '4rem auto', padding: '0 2rem' }}>
        
        {!selectedProduct ? (
          /* Storefront View */
          <div>
            <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
              <h1 style={{ fontSize: '3.5rem', fontWeight: 800, letterSpacing: '0.02em', wordSpacing: '0.08em', margin: '0 0 1rem' }}>Premium Audio.</h1>
              <p style={{ color: '#666', fontSize: '1.25rem', maxWidth: '600px', margin: '0 auto' }}>Experience sound exactly as the artist intended. Explore our curated collection of high-fidelity devices.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
              {filteredProducts.map(product => (
                <button key={product.id} onClick={() => setSelectedProduct(product)} style={{ textAlign: 'left', display: 'block', width: '100%', background: '#fcfcfc', border: '1px solid #f0f0f0', borderRadius: '24px', overflow: 'hidden', cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }} onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 24px rgba(0,0,0,0.06)' }} onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.02)' }}>
                  <div style={{ background: '#f5f5f7', height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
                    <img src={product.image} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover', mixBlendMode: 'multiply', borderRadius: '12px' }} />
                  </div>
                  <div style={{ padding: '2rem' }}>
                    <div style={{ color: '#888', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: '0.5rem' }}>{product.category}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>{product.name}</h3>
                      <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>₹{product.price}</div>
                    </div>
                    <p style={{ color: '#666', margin: '0 0 1.5rem', fontSize: '0.9rem', lineHeight: 1.5 }}>{product.description}</p>
                    <div style={{ textAlign: 'center', width: '100%', background: '#000', color: 'white', border: 'none', padding: '0.875rem', borderRadius: '99px', fontWeight: 600 }}>Buy Now</div>
                  </div>
                </button>
              ))}
              {filteredProducts.length === 0 && (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem', color: '#666' }}>
                  No products found in this category.
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Checkout View */
          <div className="checkout-layout">
            {/* Product Details */}
            <div>
              <button onClick={resetStore} style={{ background: 'transparent', border: 'none', padding: 0, display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: '#666', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', marginBottom: '2rem' }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                Back to Store
              </button>
              <div style={{ background: '#f5f5f7', borderRadius: '32px', padding: '4rem 2rem', textAlign: 'center', marginBottom: '2rem', position: 'relative', overflow: 'hidden' }}>
                <img 
                  src={selectedProduct.image} 
                  alt={selectedProduct.name} 
                  style={{ width: '100%', maxWidth: '400px', height: '300px', objectFit: 'cover', mixBlendMode: 'multiply', filter: 'drop-shadow(0 30px 30px rgba(0,0,0,0.15))' }}
                />
              </div>
              <h1 style={{ margin: '0 0 1rem', fontSize: '3rem', fontWeight: 800, letterSpacing: '0.02em', wordSpacing: '0.08em', lineHeight: 1.1 }}>{selectedProduct.name}</h1>
              <p style={{ margin: '0 0 2rem', color: '#666', fontSize: '1.25rem', lineHeight: 1.6, maxWidth: '90%' }}>
                {selectedProduct.description}
              </p>
            </div>

            {/* Checkout Form */}
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 2rem', paddingBottom: '1rem', borderBottom: '2px solid #000' }}>Order Summary</h2>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '60px', height: '60px', background: '#f5f5f7', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <img src={selectedProduct.image} alt={selectedProduct.name} style={{ width: '100%', height: '100%', objectFit: 'cover', mixBlendMode: 'multiply' }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>{selectedProduct.name}</div>
                    <div style={{ color: '#666', fontSize: '0.875rem' }}>Quantity: 1</div>
                  </div>
                </div>
                <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>₹{selectedProduct.price.toFixed(2)}</div>
              </div>

              <div style={{ margin: '2.5rem 0', padding: '2rem', background: '#f5f5f7', borderRadius: '20px' }}>
                {!appliedCoupon ? (
                  <>
                    <label htmlFor="coupon-code" style={{ display: 'block', margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: '#111', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Gift Card or Promo Code
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input 
                        id="coupon-code"
                        type="text" 
                        placeholder="Enter code"
                        value={couponCode}
                        onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                        style={{ flex: 1, padding: '1rem 1.25rem', borderRadius: '12px', border: '1px solid rgba(0,0,0,0.1)', outline: 'none', fontSize: '1rem', background: 'white', transition: 'border-color 0.2s', fontWeight: 500 }}
                        onKeyDown={(e) => e.key === 'Enter' && handleApplyCoupon()}
                      />
                      <button 
                        onClick={handleApplyCoupon}
                        disabled={loading || !couponCode.trim()}
                        style={{ padding: '0 1.5rem', background: '#000', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 600, cursor: loading || !couponCode.trim() ? 'not-allowed' : 'pointer', opacity: loading || !couponCode.trim() ? 0.7 : 1, transition: 'background 0.2s' }}
                      >
                        {loading ? 'Applying...' : 'Apply'}
                      </button>
                    </div>
                    {couponError && <p style={{ margin: '0.75rem 0 0', color: '#e11d48', fontSize: '0.875rem', fontWeight: 500 }}>{couponError}</p>}
                  </>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#111', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Voucher Applied</span>
                      <button onClick={handleRemoveCoupon} style={{ background: 'none', border: 'none', color: '#e11d48', fontSize: '0.875rem', cursor: 'pointer', padding: 0, fontWeight: 600 }}>Remove</button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '1.25rem', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                      <div>
                        <div style={{ fontWeight: 700, color: '#000', fontSize: '1rem', fontFamily: 'monospace' }}>{appliedCoupon.coupon_code}</div>
                        <div style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.25rem' }}>Balance available: ₹{(appliedCoupon.remaining_balance || 0).toFixed(2)}</div>
                      </div>
                      <div style={{ fontWeight: 800, color: '#16a34a', fontSize: '1.125rem' }}>
                        -₹{discountAmount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ margin: '0 0 2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', margin: '0 0 1rem', color: '#666', fontSize: '1rem' }}>
                  <span>Subtotal</span>
                  <span style={{ color: '#000', fontWeight: 500 }}>₹{selectedProduct.price.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', margin: '0 0 1.5rem', color: '#666', fontSize: '1rem' }}>
                  <span>Shipping</span>
                  <span style={{ color: '#16a34a', fontWeight: 600 }}>Free</span>
                </div>
                
                <div style={{ height: '1px', background: 'rgba(0,0,0,0.1)', margin: '1.5rem 0' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 2.5rem', color: '#000' }}>
                  <span style={{ fontSize: '1.25rem', fontWeight: 600 }}>Total</span>
                  <span style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '0.02em', wordSpacing: '0.08em', }}>₹{finalTotal.toFixed(2)}</span>
                </div>
              </div>

              <button 
                onClick={handleCheckout}
                disabled={checkoutState === 'processing'}
                style={{ 
                  width: '100%', 
                  padding: '1.25rem', 
                  background: '#000', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '99px', 
                  fontSize: '1.125rem', 
                  fontWeight: 700, 
                  cursor: checkoutState === 'processing' ? 'not-allowed' : 'pointer', 
                  opacity: checkoutState === 'processing' ? 0.8 : 1,
                  transition: 'transform 0.2s',
                  boxShadow: '0 10px 20px rgba(0,0,0,0.1)'
                }}
              >
                {checkoutState === 'processing' ? 'Processing...' : `Pay ₹${finalTotal.toFixed(2)}`}
              </button>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '1.5rem', color: '#888', fontSize: '0.875rem' }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                <span>Secure SSL Encrypted Checkout</span>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
