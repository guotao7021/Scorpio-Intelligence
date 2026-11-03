/** First paint uses published facts; compute and legacy portfolio enrichment are not prerequisites. */
export async function loadBootstrapWorkloads(loaders, homeFirst = false) {
  const positions = homeFirst ? Promise.resolve([]) : loaders.positions();
  const [savedPositions, market, portfolio, latestPackageRow, watchlist, sampleRows, compliance, marketBriefRows] = await Promise.all([
    positions,
    homeFirst ? loaders.publishedMarket() : loaders.market(),
    homeFirst ? loaders.deferredPortfolio() : positions.then(loaders.portfolio),
    loaders.package(), loaders.watchlist(), loaders.samples(), loaders.compliance(), loaders.briefs(),
  ]);
  return {savedPositions, market, portfolio, latestPackageRow, watchlist, sampleRows, compliance, marketBriefRows};
}
