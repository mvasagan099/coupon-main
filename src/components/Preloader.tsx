import { useState, useEffect } from "react";

const logs = [
  "Synchronizing Nodes...",
  "Establishing Secure Tunnel...",
  "Decrypting Ledger...",
  "Access Authorized."
];

export function Preloader() {
  const [percent, setPercent] = useState(0);
  const [logIndex, setLogIndex] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const [visible, setVisible] = useState(() => !sessionStorage.getItem('preloader_shown'));

  useEffect(() => {
    // Already shown this session - nothing to animate.
    if (!visible) return;

    // Faster loading: <300ms total
    const percentInterval = setInterval(() => {
      setPercent(prev => {
        if (prev >= 100) {
          clearInterval(percentInterval);
          return 100;
        }
        return prev + 10; // Jump by 10 for speed
      });
    }, 20);

    // Swap loading log lines faster
    const logInterval = setInterval(() => {
      setLogIndex(prev => {
        if (prev >= logs.length - 1) {
          clearInterval(logInterval);
          return logs.length - 1;
        }
        return prev + 1;
      });
    }, 60);

    // Fadeout at 250ms
    const fadeTimeout = setTimeout(() => {
      setFadeOut(true);
      sessionStorage.setItem('preloader_shown', 'true');
    }, 250);

    // Remove at 400ms
    const removeTimeout = setTimeout(() => {
      setVisible(false);
    }, 400);

    return () => {
      clearInterval(percentInterval);
      clearInterval(logInterval);
      clearTimeout(fadeTimeout);
      clearTimeout(removeTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount; `visible` only ever goes true -> false here
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#030712",
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        transition: "opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        opacity: fadeOut ? 0 : 1,
        transform: fadeOut ? "scale(1.05)" : "scale(1)",
        pointerEvents: "none"
      }}
    >
      <style>{`
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 40px rgba(56, 189, 248, 0.2); transform: scale(1); }
          50% { box-shadow: 0 0 60px rgba(56, 189, 248, 0.5); transform: scale(1.02); }
        }
        @keyframes spinSlow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes dash {
          0% { stroke-dasharray: 1, 150; stroke-dashoffset: 0; }
          50% { stroke-dasharray: 90, 150; stroke-dashoffset: -35; }
          100% { stroke-dasharray: 90, 150; stroke-dashoffset: -124; }
        }
      `}</style>

      {/* Decorative ambient glowing orbs */}
      <div
        style={{
          position: "absolute",
          width: "400px",
          height: "400px",
          background: "radial-gradient(circle, rgba(56, 189, 248, 0.1) 0%, transparent 70%)",
          filter: "blur(30px)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />

      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", maxWidth: "340px", width: "90%" }}>
        
        {/* Animated logo/shield icon */}
        <div style={{ position: "relative", marginBottom: "2.5rem" }}>
          {/* Spinning ring */}
          <svg style={{ position: "absolute", top: -16, left: -16, width: 96, height: 96, animation: "spinSlow 3s linear infinite" }}>
            <circle cx="48" cy="48" r="46" fill="none" stroke="rgba(56, 189, 248, 0.2)" strokeWidth="2" />
            <circle cx="48" cy="48" r="46" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" style={{ animation: "dash 1.5s ease-in-out infinite" }} />
          </svg>
          
          <div
            style={{
              width: "64px",
              height: "64px",
              background: "linear-gradient(135deg, rgba(56,189,248,0.2) 0%, rgba(56,189,248,0.05) 100%)",
              border: "1px solid rgba(56,189,248,0.3)",
              backdropFilter: "blur(10px)",
              borderRadius: "20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "pulseGlow 2s infinite ease-in-out"
            }}
          >
            <svg width="32" height="32" fill="none" viewBox="0 0 24 24">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" />
              <rect x="9" y="3" width="6" height="4" rx="1" stroke="var(--cyan)" strokeWidth="2.5" />
              <path d="M9 12h6M9 16h4" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        {/* Brand Text */}
        <span style={{ fontWeight: 900, fontSize: "1.75rem", color: "#fff", letterSpacing: "-0.04em", marginBottom: "0.25rem" }}>
          COUPON<span style={{ color: "var(--cyan)" }}>VAULT</span>
        </span>
        <span style={{ fontWeight: 600, fontSize: "0.75rem", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: "2.5rem" }}>
          System Initialization
        </span>

        {/* Loading Progress details */}
        <div style={{ width: "100%", display: "flex", justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <span className="mono" style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--cyan)", transition: "color 0.2s" }}>
            {logs[logIndex]}
          </span>
          <span className="mono" style={{ fontSize: '0.75rem', fontWeight: 800, color: '#fff' }}>
            {percent}%
          </span>
        </div>

        {/* Progress Bar Container */}
        <div style={{ width: "100%", height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "4px", overflow: "hidden", position: "relative" }}>
          {/* Animated Fill */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: `${percent}%`,
              background: "var(--cyan)",
              borderRadius: "4px",
              transition: "width 0.1s linear",
              boxShadow: "0 0 10px var(--cyan)"
            }}
          />
        </div>
      </div>
    </div>
  );
}
