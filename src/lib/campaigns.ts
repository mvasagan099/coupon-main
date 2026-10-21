import { isSupabaseConfigured, supabase } from './supabase';
import type { CatalogueBrand } from './brandCatalog';

export interface BrandCampaign {
  id: string; slug: string; name: string; category: string; description: string;
  color: string; logo_path: string; is_published: boolean; sort_order: number;
  country_code: string | null; issuer_company_id: string | null; updated_at: string;
}
export type CampaignChanges = Pick<BrandCampaign, 'name' | 'category' | 'description' | 'color' | 'is_published' | 'sort_order' | 'country_code' | 'issuer_company_id'>;
export function campaignBrand(row: BrandCampaign): CatalogueBrand {
  return { slug: row.slug, name: row.name, category: row.category, description: row.description, color: row.color, logoPath: row.logo_path, issuerCompanyId: row.issuer_company_id };
}
export async function getBrandCampaigns(admin = false): Promise<BrandCampaign[]> {
  if (!isSupabaseConfigured) throw new Error('Campaign database is not configured.');
  let query = supabase.from('brand_campaigns').select('*').order('sort_order').order('slug');
  if (!admin) query = query.eq('is_published', true);
  const { data, error } = await query;
  if (error) throw new Error('Campaigns could not be loaded. Check that the campaign database migration has been applied.');
  return data ?? [];
}
export async function updateBrandCampaign(id: string, updatedAt: string, changes: CampaignChanges): Promise<BrandCampaign> {
  if (!isSupabaseConfigured) throw new Error('Campaign database is not configured.');
  const { name, category, description, color, is_published, sort_order, country_code, issuer_company_id } = changes;
  const { data, error } = await supabase.from('brand_campaigns').update({ name: name.trim(), category: category.trim(), description: description.trim(), color, is_published, sort_order, country_code, issuer_company_id }).eq('id', id).eq('updated_at', updatedAt).select('*').single();
  if (error || !data) throw new Error('Campaign was not saved. It may have changed or your admin access may have expired. Reload before retrying.');
  return data;
}
