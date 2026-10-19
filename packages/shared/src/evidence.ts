/** Versioned category evidence, never a claim of physical observation/stock. */
export const BEER_POLICY_VERSION = 'beer-evidence-v1';
export function assessBeerEvidence(tags: Record<string, string>, placeType: string) {
  if (tags.alcohol === 'no' || tags['drink:beer'] === 'no') {
    return { eligible: false, status: 'no', reason: 'explicit_no_beer' } as const;
  }
  if (tags.disused === 'yes' || tags.abandoned === 'yes' || tags.access === 'private') {
    return { eligible: false, status: 'unknown', reason: 'inactive_or_private' } as const;
  }
  const beer = tags['drink:beer'] === 'yes';
  if (placeType === 'gasolinera') {
    const retail = ['convenience', 'supermarket', 'alcohol'].includes(tags.shop ?? '');
    if (tags.shop === 'no' || (!retail && !beer)) {
      return {
        eligible: false,
        status: 'unknown',
        reason: 'fuel_without_retail_evidence',
      } as const;
    }
  }
  if (placeType === 'otro') {
    return { eligible: false, status: 'unknown', reason: 'unsupported_category' } as const;
  }
  return {
    eligible: true,
    status: beer ? 'documented' : 'likely',
    reason: beer ? 'osm_beer_tag' : 'category_inference',
  } as const;
}
