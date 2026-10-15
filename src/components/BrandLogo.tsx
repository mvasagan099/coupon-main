import type { CatalogueBrand } from '../lib/brandCatalog';

export default function BrandLogo({ brand, size = 'card' }: { brand: CatalogueBrand; size?: 'card' | 'hero' }) {
  return <span className={`brand-logo brand-logo--${size}`}>
    <img src={brand.logoPath} alt={`${brand.name} logo`} width={64} height={64} decoding="async" />
  </span>;
}
