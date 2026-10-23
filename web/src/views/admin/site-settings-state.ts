export interface SiteBannerDraft {
  asset_id: string;
  sort: number;
}

function sortBanners(banners: readonly SiteBannerDraft[]): SiteBannerDraft[] {
  return [...banners].sort((left, right) => left.sort - right.sort || left.asset_id.localeCompare(right.asset_id));
}

function nextSortValue(banners: readonly SiteBannerDraft[]): number {
  return (banners.reduce((max, banner) => Math.max(max, banner.sort), 0) || 0) + 10;
}

export function addSiteBanner(banners: readonly SiteBannerDraft[], assetId: string): SiteBannerDraft[] {
  if (!assetId || banners.length >= 3 || banners.some((banner) => banner.asset_id === assetId)) return sortBanners(banners);
  return sortBanners([...banners, { asset_id: assetId, sort: nextSortValue(banners) }]);
}

export function removeSiteBanner(banners: readonly SiteBannerDraft[], assetId: string): SiteBannerDraft[] {
  return sortBanners(banners.filter((banner) => banner.asset_id !== assetId));
}
