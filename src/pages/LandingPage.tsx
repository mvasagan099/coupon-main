import { Link } from 'react-router-dom';

const featuredBrands = [
  { name: 'Amazon', price: 'From ₹250', image: 'https://images.unsplash.com/photo-1622547748225-3fc4abd2cca0?w=800&auto=format&fit=crop&q=80', accent: '#111827' },
  { name: 'Nike', price: 'From ₹500', image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&auto=format&fit=crop&q=80', accent: '#111111' },
  { name: 'Starbucks', price: 'From ₹200', image: 'https://images.unsplash.com/photo-1559925393-8be0ec4767c8?w=800&auto=format&fit=crop&q=80', accent: '#006241' },
  { name: 'Apple', price: 'From ₹1000', image: 'https://images.unsplash.com/photo-1491933382434-500287f9b54b?w=800&auto=format&fit=crop&q=80', accent: '#333333' },
];

const getBrandLogo = (name: string) => {
  switch (name.toLowerCase()) {
    case 'amazon':
      return (
        <svg viewBox="0 0 16 16" width="30" height="30" fill="currentColor">
          <path d="M10.813 11.968c.157.083.36.074.5-.05l.005.005a90 90 0 0 1 1.623-1.405c.173-.143.143-.372.006-.563l-.125-.17c-.345-.465-.673-.906-.673-1.791v-3.3l.001-.335c.008-1.265.014-2.421-.933-3.305C10.404.274 9.06 0 8.03 0 6.017 0 3.77.75 3.296 3.24c-.047.264.143.404.316.443l2.054.22c.19-.009.33-.196.366-.387.176-.857.896-1.271 1.703-1.271.435 0 .929.16 1.188.55.264.39.26.91.257 1.376v.432q-.3.033-.621.065c-1.113.114-2.397.246-3.36.67C3.873 5.91 2.94 7.08 2.94 8.798c0 2.2 1.387 3.298 3.168 3.298 1.506 0 2.328-.354 3.489-1.54l.167.246c.274.405.456.675 1.047 1.166ZM6.03 8.431C6.03 6.627 7.647 6.3 9.177 6.3v.57c.001.776.002 1.434-.396 2.133-.336.595-.87.961-1.465.961-.812 0-1.286-.619-1.286-1.533M.435 12.174c2.629 1.603 6.698 4.084 13.183.997.28-.116.475.078.199.431C13.538 13.96 11.312 16 7.57 16 3.832 16 .968 13.446.094 12.386c-.24-.275.036-.4.199-.299z"/>
          <path d="M13.828 11.943c.567-.07 1.468-.027 1.645.204.135.176-.004.966-.233 1.533-.23.563-.572.961-.762 1.115s-.333.094-.23-.137c.105-.23.684-1.663.455-1.963-.213-.278-1.177-.177-1.625-.13l-.09.009q-.142.013-.233.024c-.193.021-.245.027-.274-.032-.074-.209.779-.556 1.347-.623"/>
        </svg>
      );
    case 'nike':
      return (
        <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor">
          <path d="M24 7.8L6.442 15.276c-1.456.616-2.679.925-3.668.925-1.12 0-1.933-.392-2.437-1.177-.317-.504-.41-1.143-.28-1.918.13-.775.476-1.6 1.036-2.478.467-.71 1.232-1.643 2.297-2.8a6.122 6.122 0 00-.784 1.848c-.28 1.195-.028 2.072.756 2.632.373.261.886.392 1.54.392.522 0 1.11-.084 1.764-.252L24 7.8z"/>
        </svg>
      );
    case 'apple':
      return (
        <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
          <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>
        </svg>
      );
    case 'starbucks':
      return (
        <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
          <path d="M13.2072 5.2801c-.1052-.0188-.6126-.104-1.2072-.104s-1.102.0848-1.2072.104c-.0605.0108-.0837-.0484-.0377-.0828.0417-.0308 1.2445-.9463 1.2445-.9463l1.244.9463c.0469.0344.024.0936-.0364.0828zm-2.0783 5.9446s-.0636.0228-.0804.0788c.252.1937.4257.6343.9515.6343s.6995-.4406.9511-.6343c-.0164-.0564-.08-.0788-.08-.0788s-.3293.0776-.8711.0776c-.5418 0-.8711-.0776-.8711-.0776zM12 10.4832c-.146 0-.178-.0552-.2777-.0548-.0948.0004-.2789.076-.319.1453a.1542.1542 0 00.0413.0948c.2129.032.309.1505.5558.1505.2469 0 .3425-.1185.5558-.1505a.1579.1579 0 00.0412-.0948c-.0396-.0692-.224-.1445-.3193-.1453-.1-.0008-.1324.0548-.2781.0548zm11.9868 2.27a11.964 11.964 0 01-.076.8528c-1.359.2249-1.8447-.986-3.2368-.9252.0832.2954.1508.5963.2029.9036 1.148-.0008 1.6105 1.0724 2.8878.9143-.0672.3281-.148.6519-.2413.9708-1.01.0992-1.3657-.9044-2.5345-.8767.0096.1664.0148.3345.0148.5041l-.0048.2805 2.2696.866a12.04 12.04 0 01-.3965.9479c-.6823-.0376-.9175-.9127-1.9555-.8431a9.0882 9.0882 0 01-.118.665c.9015-.0632 1.0955.7667 1.7414.834a12.2317 12.2317 0 01-.5302.8767c-.3826-.205-.7143-.8231-1.4398-.8612a8.6035 8.6035 0 00.195-.6994c-.6435 0-1.3794-.2509-1.9964-.8127.2-1.1388-1.5674-2.2984-1.5674-3.1324 0-.9059.4582-1.4073.4582-2.6285 0-.9063-.4402-1.8895-1.104-2.5614a2.2175 2.2175 0 00-.4114-.3309c.6098.7547 1.078 1.6494 1.078 2.6858 0 1.15-.535 1.757-.535 2.8186 0 1.0612 1.5526 1.9796 1.5526 3.074 0 .4305-.1377.851-.5914 1.677.697.6962 1.605 1.076 2.1908 1.076.19 0 .292-.058.3601-.2073a9.0925 9.0925 0 00.1665-.391c.631.0245.9199.5979 1.2692.8268-.1916.2573-.393.5057-.6038.7462-.234-.2593-.5486-.6954-1.0092-.8167a9.2087 9.2087 0 01-.2613.473c.3966.108.6679.5082.878.7715a12.1305 12.1305 0 01-.7075.6754c-.1532-.2384-.3917-.541-.659-.7042a8.3639 8.3639 0 01-.3077.391c.2272.154.4277.4313.5586.6574-.2833.2272-.5763.443-.8796.6446-.1496-1.2192-1.8138-2.0548-1.3653-3.4693-.1472.2493-.3229.561-.3229.9364 0 1.024 1.0908 1.8366 1.1776 2.8542-.226.1353-.4573.2625-.693.383-.0392-1.1185-1.194-2.3425-1.194-3.2604 0-1.0248 1.342-2.054 1.342-3.2636 0-1.2105-1.5485-2.0484-1.5485-3.1112 0-1.062.6586-1.673.6586-3.0343 0-.9972-.4738-2.0063-1.2056-2.651-.1297-.1144-.2573-.2052-.4106-.2849.6903.828 1.0904 1.579 1.0904 2.7186 0 1.2801-.7546 1.9908-.7546 3.244 0 1.2537 1.5197 1.9507 1.5197 3.1192 0 1.1684-1.4145 2.1532-1.4145 3.3536 0 1.092 1.2468 2.182 1.2653 3.4777a11.7704 11.7704 0 01-.8327.3257c.1584-1.3089-1.245-2.659-1.245-3.727 0-1.1676 1.4674-2.1712 1.4674-3.43 0-1.2597-1.4917-1.8451-1.4917-3.138 0-1.292.9151-2.0075.9151-3.4352 0-1.1129-.5494-2.1136-1.352-2.7338l-.0509-.0385c-.0756-.056-.138.0116-.0844.078.5682.7095.8719 1.427.8719 2.4894 0 1.306-1.0512 2.3673-1.0512 3.6325 0 1.4934 1.4117 1.9203 1.4117 3.1456 0 1.2248-1.5137 2.2048-1.5137 3.5053 0 1.206 1.4325 2.5445 1.1868 3.9366a11.6645 11.6645 0 01-.8743.192c.2689-1.7334-1.1364-2.9782-1.1364-4.1122 0-1.2277 1.5677-2.322 1.5677-3.5217 0-1.1316-1.1252-1.5014-1.2732-2.659-.0204-.158-.1473-.2753-.3221-.2461-.2285.0416-.5214.192-.9816.192-.4602 0-.753-.1508-.982-.192-.1744-.0288-.3013.0884-.3217.246-.1476 1.1577-1.2736 1.527-1.2736 2.659 0 1.1997 1.5681 2.2937 1.5681 3.5218 0 1.134-1.4053 2.3788-1.1368 4.1123a12.1233 12.1233 0 01-.8743-.1921c-.2457-1.3921 1.1872-2.7306 1.1872-3.9366 0-1.3005-1.5141-2.2805-1.5141-3.5053 0-1.2253 1.412-1.6522 1.412-3.1456 0-1.2652-1.0515-2.326-1.0515-3.6325 0-1.062.3037-1.7795.8723-2.4893.0532-.0665-.0088-.134-.0848-.078l-.0504.0384c-.802.6186-1.351 1.6193-1.351 2.7322 0 1.4277.9152 2.1431.9152 3.4352 0 1.2925-1.4917 1.878-1.4917 3.138 0 1.2588 1.4673 2.2624 1.4673 3.43 0 1.0684-1.4033 2.4181-1.2445 3.727a11.8995 11.8995 0 01-.833-.3257c.0188-1.2957 1.2648-2.3861 1.2648-3.4777 0-1.2004-1.4137-2.1852-1.4137-3.3536 0-1.1685 1.519-1.8655 1.519-3.1192 0-1.2532-.7543-1.9639-.7543-3.244 0-1.1396.3997-1.8907 1.09-2.7186-.1537.0797-.281.1705-.4102.285-.7318.6446-1.2052 1.6537-1.2052 2.651 0 1.3612.6586 1.9722.6586 3.0342 0 1.0628-1.5485 1.9007-1.5485 3.1112 0 1.2096 1.342 2.2392 1.342 3.2636 0 .9183-1.1556 2.1423-1.1944 3.2604a11.8754 11.8754 0 01-.693-.383c.0872-1.0176 1.1776-1.8303 1.1776-2.8542 0-.3754-.1753-.687-.323-.9364.4486 1.4145-1.2156 2.25-1.3652 3.4693a12.1204 12.1204 0 01-.8796-.6446c.1305-.2257.331-.5034.5586-.6575a7.9134 7.9134 0 01-.3077-.391c-.2677.1633-.5066.4659-.6594.7043a12.2459 12.2459 0 01-.707-.6754c.21-.2633.4813-.6635.8779-.7715a9.0433 9.0433 0 01-.2613-.473c-.4606.1213-.7755.5574-1.0092.8167a12.141 12.141 0 01-.6038-.7462c.3493-.229.6382-.8027 1.2688-.8267.0529.1312.1085.2617.1669.3909.068.1493.1705.2073.3601.2073.5858 0 1.4934-.3798 2.1908-1.076-.4537-.826-.5914-1.2465-.5914-1.677 0-1.094 1.5526-2.0124 1.5526-3.074 0-1.0615-.535-1.6686-.535-2.8186 0-1.0364.4682-1.9311 1.078-2.6858a2.2175 2.2175 0 00-.4114.331c-.6638.6722-1.104 1.655-1.104 2.5613 0 1.2212.4586 1.7226.4586 2.6285 0 .834-1.7679 1.9936-1.5678 3.1324-.617.5618-1.3529.8127-1.9967.8127a9.305 9.305 0 00.1949.6994c-.7251.0385-1.0568.6567-1.4398.8612a12.0872 12.0872 0 01-.5302-.8768c.6455-.0672.84-.897 1.7419-.8339a9.1275 9.1275 0 01-.1185-.665c-1.038-.0696-1.2732.8059-1.9555.8431a12.04 12.04 0 01-.3965-.948l2.27-.8659-.0048-.2805c0-.1696.0052-.3377.0144-.5041-1.1688-.0273-1.5246.976-2.5345.8767a12.106 12.106 0 01-.241-.9708c1.2766.158 1.7395-.9151 2.888-.9143a8.7482 8.7482 0 01.2024-.9036c-1.392-.0604-1.8779 1.1505-3.2364.9252a11.7352 11.7352 0 01-.076-.8527c1.5794.1764 2.1716-1.122 3.6097-.9632a8.4303 8.4303 0 01.471-.9963c-1.803-.317-2.4153 1.1908-4.0935.9591C.1813 5.2805 5.4844.0898 12 .0898S23.8187 5.2805 24 11.753c-1.6786.2317-2.2908-1.2757-4.0935-.9591.1773.32.335.6526.471.9963 1.4373-.1592 2.0295 1.1396 3.6093.9632zm-17.147-5.035c-.884-.3613-1.954-.278-2.868.309-.1416-.8504-.603-1.6058-1.26-2.0616-.0908-.0628-.1853-.0032-.1769.102.1389 1.7967-.9115 3.3569-2.2032 4.7282 1.3313.4001 2.4645-1.3141 4.1912-.7159a9.0364 9.0364 0 012.3168-2.3617zM12 6.6314c-1.1144 0-2.048.6303-2.2924 1.4446-.0188.0624.0068.1028.0788.0704.2005-.09.4285-.1333.6762-.1333.4546 0 .8551.1669 1.092.4574.1049.3457.1137.8463-.0048 1.132-.1872-.042-.2545-.1868-.4373-.1868-.1829 0-.3245.1284-.6347.1284-.3097 0-.346-.1465-.5498-.1465-.2396 0-.2837.247-.2837.5254 0 1.2417 1.1413 2.9503 2.3553 2.9503 1.2136 0 2.3549-1.7086 2.3549-2.9503 0-.2785-.0573-.517-.3077-.5494-.1249.09-.2397.1705-.5254.1705-.3102 0-.3958-.1284-.5783-.1284-.2204 0-.1984.465-.4601.491-.1745-.4194-.1829-.9572-.038-1.4362.2373-.2905.6374-.4574 1.092-.4574.2477 0 .4773.0437.6758.1333.0724.0324.0976-.0084.0788-.0704-.244-.8143-1.1772-1.4446-2.2916-1.4446zm1.7743 1.7815c-.2673 0-.5807.082-.7775.3013-.0204.0596-.0204.1484.0084.2077.4845-.166.9119-.1725 1.1184.0584.11-.1.1452-.19.1452-.2945 0-.1613-.164-.273-.4945-.273zm-3.8979.5674c.2337-.234.7263-.224 1.238-.0352.0225-.2545-.4333-.5326-.8887-.5326-.3309 0-.4945.1116-.4945.2733 0 .1044.0352.1949.1452.2945zm7.6804-4.2031c-.8799.0628-1.6442.3649-2.2624.8683.2625-.7443.5958-1.3953 1.0184-2.0264-1.1204.1189-2.0572.5286-2.7406 1.2289l-.535-1.4025 1.1876-1.0488-1.5902-.1125L12 .8053l-.635 1.479-1.5902.1124 1.1876 1.0488-.5346 1.4025c-.6838-.7003-1.6206-1.11-2.7402-1.2289.4218.6315.7551 1.2825 1.0176 2.0264-.6178-.5038-1.3821-.806-2.262-.8683.5278.6786.9955 1.402 1.342 2.18.0393.0876.1233.1164.2141.0712 1.2053-.599 2.5634-.936 4.0003-.936 1.437 0 2.7946.3374 4.0007.936.0908.0452.1748.0164.2136-.0712.347-.778.8147-1.5014 1.343-2.18zm1.9211 5.3035c1.7259-.5982 2.8595 1.1156 4.1908.7159-1.2917-1.3713-2.3417-2.9315-2.2028-4.7282.0084-.1052-.0865-.1652-.1769-.102-.6574.4558-1.1188 1.2112-1.26 2.0615-.9144-.587-1.984-.6706-2.868-.3089a9.0431 9.0431 0 012.317 2.3617z"/>
        </svg>
      );
    default:
      return null;
  }
};

export default function LandingPage() {
  return (
    <div className="fade-in" style={{ paddingBottom: '3rem' }}>
      <section className="hero-section">
        <div className="app-shell hero-shell">
          <div className="hero-copy">
            <span className="hero-pill-badge">
              <span className="hero-pill-badge-icon">✦</span>
              Global gifting, curated beautifully
            </span>
            <h1 className="hero-title">
              Give better with a <br />
              <span className="hero-title-gradient">premium gift card</span> <br />
              experience.
            </h1>
            <p
              style={{
                margin: 0,
                maxWidth: '58ch',
                color: 'var(--text-3)',
                fontSize: '0.96rem',
                lineHeight: 1.65,
              }}
            >
              CouponVault blends marketplace discovery, secure redemption, and merchant controls into a
              polished gifting platform that feels elevated from the first click to the final scan.
            </p>

            <div className="hero-actions">
              <Link className="btn btn-primary btn-lg btn-explore-gradient" to="/userlogin">
                Explore marketplace <span className="btn-arrow">→</span>
              </Link>
              <Link className="btn btn-secondary btn-lg btn-company-outline" to="/companylogin">
                Company login <span className="btn-arrow">→</span>
              </Link>
            </div>

            <div className="hero-stat-grid-premium">
              <div className="stat-pill-card">
                <div className="stat-pill-icon-wrapper purple">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7-3c1.66 0 3 1.34 3 3H9c0-1.66 1.34-3 3-3zm7 17H5V8h14v12z"/>
                  </svg>
                </div>
                <div className="stat-pill-info">
                  <span className="stat-pill-val">100+</span>
                  <span className="stat-pill-lbl">Brands live</span>
                </div>
              </div>

              <div className="stat-pill-card">
                <div className="stat-pill-icon-wrapper blue">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M7 2v 11h3v9l7-12h-4l4-8z"/>
                  </svg>
                </div>
                <div className="stat-pill-info">
                  <span className="stat-pill-val">2 min</span>
                  <span className="stat-pill-lbl">Average redemption</span>
                </div>
              </div>

              <div className="stat-pill-card">
                <div className="stat-pill-icon-wrapper green">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    <path d="M9 11l2 2 4-4"/>
                  </svg>
                </div>
                <div className="stat-pill-info">
                  <span className="stat-pill-val">24/7</span>
                  <span className="stat-pill-lbl">Merchant validation</span>
                </div>
              </div>
            </div>
          </div>

          <div className="hero-visual-scene-container">
            {/* Ambient background glows */}
            <div className="ambient-glow glow-1" />
            <div className="ambient-glow glow-2" />
            <div className="ambient-glow glow-3" />

            <div className="scene-pivot-3d">
              {/* Glass Podium/Stand */}
              <div className="podium-stand">
                <div className="podium-glass-top" />
                <div className="podium-glass-rim" />
                <div className="podium-light-glow" />
              </div>

              {/* Floating Success Alert Card */}
              <div className="floating-element success-alert-pill">
                <div className="gift-circle-icon">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M20 6h-2.18c.11-.31.18-.65.18-1 0-1.66-1.34-3-3-3-1.05 0-1.96.54-2.5 1.35l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h3.08L10 11.23l1.84-2.47c.29-.38.74-.61 1.23-.61.12 0 .23.01.35.04L13.72 8H20v6z"/>
                  </svg>
                </div>
                <div className="success-alert-details">
                  <span className="success-alert-title">Gift sent successfully!</span>
                  <span className="success-alert-amount">₹250.00</span>
                </div>
                <div className="success-check-badge">✓</div>
              </div>

              {/* Floating Scan to Pay Card */}
              <div className="floating-element scan-pay-card">
                <div className="qr-code-box">
                  <svg viewBox="0 0 24 24" width="46" height="46" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* Top Left Finder Pattern */}
                    <rect x="1" y="1" width="6" height="6" rx="1.2" stroke="#0f172a" strokeWidth="1.5" />
                    <rect x="2.5" y="2.5" width="3" height="3" rx="0.5" fill="#0f172a" />
                    
                    {/* Top Right Finder Pattern */}
                    <rect x="17" y="1" width="6" height="6" rx="1.2" stroke="#0f172a" strokeWidth="1.5" />
                    <rect x="18.5" y="2.5" width="3" height="3" rx="0.5" fill="#0f172a" />
                    
                    {/* Bottom Left Finder Pattern */}
                    <rect x="1" y="17" width="6" height="6" rx="1.2" stroke="#0f172a" strokeWidth="1.5" />
                    <rect x="2.5" y="18.5" width="3" height="3" rx="0.5" fill="#0f172a" />
                    
                    {/* Data Modules (Dots & Small Rects for realistic QR look) */}
                    <rect x="9" y="1" width="1.5" height="1.5" fill="#0f172a" />
                    <rect x="12" y="1" width="1.5" height="3" fill="#0f172a" />
                    <rect x="14" y="2" width="1.5" height="1.5" fill="#0f172a" />
                    
                    <rect x="9" y="4" width="3" height="1.5" fill="#0f172a" />
                    <rect x="14" y="5" width="1.5" height="1.5" fill="#0f172a" />
                    
                    <rect x="1" y="9" width="3" height="1.5" fill="#0f172a" />
                    <rect x="5" y="9" width="1.5" height="1.5" fill="#0f172a" />
                    <rect x="8" y="8" width="1.5" height="3" fill="#0f172a" />
                    <rect x="11" y="9" width="3" height="1.5" fill="#0f172a" />
                    <rect x="16" y="8" width="1.5" height="1.5" fill="#0f172a" />
                    <rect x="19" y="9" width="4" height="1.5" fill="#0f172a" />
                    
                    <rect x="2.5" y="12" width="1.5" height="3" fill="#0f172a" />
                    <rect x="6" y="12" width="3" height="1.5" fill="#0f172a" />
                    <rect x="10" y="12" width="1.5" height="1.5" fill="#0f172a" />
                    <rect x="13" y="12" width="1.5" height="3" fill="#0f172a" />
                    <rect x="16" y="11" width="1.5" height="1.5" fill="#0f172a" />
                    <rect x="18" y="12" width="3" height="1.5" fill="#0f172a" />
                    <rect x="22" y="12" width="1.5" height="3" fill="#0f172a" />
                    
                    <rect x="9" y="15" width="1.5" height="1.5" fill="#0f172a" />
                    <rect x="11" y="16" width="3" height="1.5" fill="#0f172a" />
                    <rect x="16" y="15" width="1.5" height="3" fill="#0f172a" />
                    <rect x="19" y="15" width="1.5" height="1.5" fill="#0f172a" />
                    
                    <rect x="9" y="18" width="3" height="1.5" fill="#0f172a" />
                    <rect x="13" y="19" width="1.5" height="3" fill="#0f172a" />
                    <rect x="16" y="19" width="3" height="1.5" fill="#0f172a" />
                    <rect x="20" y="18" width="3" height="1.5" fill="#0f172a" />
                    
                    <rect x="1" y="14" width="1.5" height="1.5" fill="#0f172a" opacity="0.3" />
                    <rect x="21" y="21" width="2" height="2" fill="#0f172a" />
                    <rect x="9" y="21" width="3" height="1.5" fill="#0f172a" />
                    <rect x="18" y="21" width="1.5" height="1.5" fill="#0f172a" />
                  </svg>
                </div>
                <span className="scan-pay-text">Scan to pay</span>
              </div>

              {/* Floating Instant Validation Badge */}
              <div className="floating-element validation-badge">
                <div className="lightning-circle-icon">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M7 2v 11h3v9l7-12h-4l4-8z"/>
                  </svg>
                </div>
                <span className="validation-text">Instant Validation</span>
              </div>

              {/* Main 3D Rotated Pass Card */}
              <div className="floating-3d-card-wrapper">
                <div className="couponvault-card">
                  <div className="card-gloss-sheen" />
                  
                  <div className="contactless-waves">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M2 17.5c2.5-2.5 5.5-2.5 8 0" opacity="0.3"/>
                      <path d="M4 14.5c3.5-3.5 8.5-3.5 12 0" opacity="0.6"/>
                      <path d="M6 11.5c4.5-4.5 11.5-4.5 16 0"/>
                    </svg>
                  </div>

                  <div className="card-header">
                    <span className="card-logo-text">COUPONVAULT PASS</span>
                    <span className="card-header-lbl">Available balance</span>
                  </div>

                  <div className="card-balance-section">
                    <h2 className="card-balance-val">₹250.00</h2>
                    <p className="card-balance-desc">Ready to scan, spend, and share</p>
                  </div>

                  <div className="card-overlay-elements">
                    <div className="glass-panel">
                      <span className="panel-hdr-lbl">CHECKOUT READY</span>
                      <div className="panel-body-row">
                        <div className="panel-body-text">
                          <span className="panel-body-title">QR redemption</span>
                          <span className="panel-body-subtitle">Instant validation at merchant counters</span>
                        </div>
                        <span className="live-status-pill">LIVE</span>
                      </div>
                    </div>

                    <div className="glass-row">
                      <div className="glass-panel half-panel">
                        <div className="half-panel-content">
                          <span className="half-panel-val">12%</span>
                          <span className="half-panel-lbl">average savings</span>
                        </div>
                      </div>

                      <div className="glass-panel half-panel">
                        <div className="half-panel-content flex-row">
                          <div className="flex-col">
                            <span className="half-panel-val">Secure</span>
                            <span className="half-panel-lbl">merchant verification</span>
                          </div>
                          <div className="shield-icon-wrapper">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            </svg>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              </div>

            </div>
          </div>
        </div>
      </section>
      
      <section id="marketplace" className="app-shell" style={{ marginTop: '2rem' }}>
        <div className="feature-header">
          <div>
            <span className="section-label">Featured marketplace</span>
            <h2 style={{ margin: '0.45rem 0 0', fontSize: '1.45rem', fontWeight: 700, letterSpacing: '0.02em', wordSpacing: '0.08em', }}>
              High-appeal brands, ready to gift
            </h2>
          </div>
          <Link to="/userlogin" style={{ color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>
            Open customer portal
          </Link>
        </div>

        <div className="responsive-grid-4">
          {featuredBrands.map((brand) => (
            <div key={brand.name} className="card gift-card-item">
              <div className="gift-card-image-wrapper">
                <div
                  className="gift-card-image"
                  style={{ backgroundImage: `url(${brand.image})` }}
                />
                <div className="gift-card-overlay" />
                
                <span className="badge gift-card-badge">
                  Popular pick
                </span>
                
                <div className="gift-card-logo-container">
                  {getBrandLogo(brand.name)}
                </div>

                <div className="gift-card-name">{brand.name}</div>
              </div>
              <div className="gift-card-info">
                <div className="gift-card-title">{brand.name} gift card</div>
                <div className="gift-card-price">{brand.price}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="experience" className="app-shell" style={{ marginTop: '1.5rem' }}>
        <div className="responsive-grid-3">
          {[
            {
              title: 'Curated marketplace',
              body: 'Browse beautifully merchandised gift cards with clear value, savings, and redemption terms.',
            },
            {
              title: 'Merchant operations',
              body: 'Launch campaigns, validate cards, and monitor liabilities in one premium back office.',
            },
            {
              title: 'Trusted redemptions',
              body: 'Move from wallet to counter scan with secure QR flows and clean transaction visibility.',
            },
          ].map((item) => (
            <div key={item.title} className="glass-card-strong" style={{ padding: '1.25rem' }}>
              <div className="badge badge-purple" style={{ marginBottom: '1rem' }}>
                Experience
              </div>
              <h2 style={{ margin: '0 0 0.65rem', fontSize: '1.08rem', fontWeight: 700, letterSpacing: '0.02em', wordSpacing: '0.08em', }}>{item.title}</h2>
              <p style={{ margin: 0, color: 'var(--text-3)', lineHeight: 1.6, fontSize: '0.9rem' }}>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      

      <section id="business" className="app-shell" style={{ marginTop: '2rem' }}>
        <div
          className="glass-card-strong business-shell"
        >
          <div className="business-copy">
            <span className="badge badge-green" style={{ marginBottom: '1rem' }}>
              For business teams
            </span>
            <h2 style={{ margin: '0 0 0.8rem', fontSize: '1.45rem', fontWeight: 700, letterSpacing: '0.02em', wordSpacing: '0.08em', maxWidth: '16ch' }}>
              Launch and manage campaigns with confidence.
            </h2>
            <p style={{ margin: 0, color: 'var(--text-3)', lineHeight: 1.6, fontSize: '0.92rem', maxWidth: '54ch' }}>
              Merchant onboarding, issuance limits, redemption tracking, and approval workflows are all
              already wired into the app. The redesign elevates how those flows look and feel without changing
              the underlying logic.
            </p>
          </div>

          <div className="glass-card business-panel">
            <div className="responsive-grid-2">
              {[
                'Approval queue',
                'Campaign creator',
                'Redemption scanner',
                'Analytics snapshots',
              ].map((item) => (
                <div key={item} className="glass-card" style={{ padding: '1rem', borderRadius: '22px' }}>
                  <div className="section-label" style={{ marginBottom: '0.4rem' }}>
                    Included
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{item}</div>
                </div>
              ))}
            </div>
            <Link className="btn btn-primary" to="/companylogin" style={{ marginTop: '1rem', width: '100%' }}>
              Enter company login
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
