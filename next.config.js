// landofredemption.com is becoming this app's canonical domain (Track 1 spec:
// docs/superpowers/specs/2026-09-06-lor-domain-cutover-design.md); redemptionccg.app
// 308s to it at the Vercel domain level, preserving path + query, so these rules
// only need to run once, on the canonical host.
const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
// Exact Blob host for next/image. A wildcard here would let anyone run their
// own Vercel Blob store's images through our optimizer at our expense.
const blobHost = blobBase ? new URL(blobBase).hostname : null;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `next build` and `next dev` share .next/ — running a build while the dev
  // server is up corrupts the dev server's cache (missing vendor-chunks, 500s).
  // Verification builds should run in a separate dir:
  //   NEXT_DIST_DIR=.next-build npm run build
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // @vercel/blob 2.4.x pulls in Node-only deps (@vercel/oidc, undici) that read
  // fs/path and have no react-server export condition, so webpack bundling them
  // into the RSC server bundle throws at load. Externalize so Next require()s the
  // package at runtime (which works) instead of bundling it.
  // @resvg/resvg-js (the Forge rendered-play-card renderer) is a native addon that loads a
  // per-platform .node binary at runtime; bundling it breaks that lookup.
  serverExternalPackages: ['@vercel/blob', '@resvg/resvg-js'],
  experimental: {
    // Server Actions cap request bodies at 1MB by default; Forge card art is
    // validated up to 15MB (validateArtFile / MAX_ART_BYTES), so raise the limit
    // to match (+ multipart overhead). Note: on Vercel, very large uploads may
    // still hit the platform request-body limit — switch art upload to a
    // client-direct-to-Blob flow if that becomes a problem in production.
    serverActions: {
      bodySizeLimit: '16mb',
    },
  },
  webpack: (config) => {
    config.externals = [...(config.externals || []), { canvas: 'canvas' }];
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        port: '',
        pathname: '/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/setimages/general/**',
      },
      ...(blobHost
        ? [{ protocol: 'https', hostname: blobHost }]
        : [{ protocol: 'https', hostname: '*.public.blob.vercel-storage.com' }]),
    ],
    // Enable optimization for large amounts of images
    minimumCacheTTL: 31536000, // 1 year
    // Every <Image> in the app renders at the default q=75. Leaving `qualities`
    // unset makes all 100 quality values valid cache keys (and billable
    // transformations) for anyone who edits the /_next/image query string.
    qualities: [75],
    // Card art is stored at 345x495 (app/forge/lib/catalogRow.ts), so the 2048
    // and 3840 device widths only ever produced upscales. Trimmed from Next's
    // 8+8 defaults to cut transformation cardinality per source image.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [64, 96, 128, 256, 384],
    // Allow unoptimized images for API routes
    unoptimized: false,
  },
  outputFileTracingIncludes: {
    '/threshingfloor/outline': ['./app/threshingfloor/outline.html'],
    '/threshingfloor/episodes/[episode]': ['./app/threshingfloor/outline.html'],
    '/api/v1/generate-decklist': ['./assets/decksheets/**'],
    '/api/v1/generate-decklist-image': ['./assets/decksheets/fonts/**'],
    // The art route's kind=rendered branch reads the frame kit and the committed fonts from
    // disk (app/forge/lib/renderCard.ts). frameAssetsTrace.test.ts checks this list.
    '/forge/api/art/[cardId]': [
      './public/forge/frames/washes/**',
      './public/forge/frames/icons/**',
      './public/forge/frames/badges/**',
      './public/forge/fonts/*.ttf',
    ],
  },
  async redirects() {
    return [
      // WordPress media -> the Blob mirror created for the article import
      // (same `wp/wp-content/uploads/...` scheme; see scripts/lib/wxr/urls.ts
      // and scripts/mirror-lor-files.ts). Individual posts' bodies were
      // already rewritten to these URLs at import time — this rule covers
      // links from outside the tracker (search results, other sites).
      ...(blobBase
        ? [
            {
              source: '/wp-content/uploads/:path*',
              destination: `${blobBase}/wp/wp-content/uploads/:path*`,
              permanent: true,
            },
            {
              source: '/podcasts/:path*',
              destination: `${blobBase}/wp/podcasts/:path*`,
              permanent: true,
            },
          ]
        : []),
      // WordPress pages that now live at a different tracker path. Posts
      // (`/<slug>/`) are handled by app/[wpSlug]/page.tsx instead, since
      // that mapping is per-post data, not a fixed rule.
      { source: '/feed', destination: '/articles/feed.xml', permanent: true },
      { source: '/feed/', destination: '/articles/feed.xml', permanent: true },
      { source: '/our-sponsors', destination: '/sponsors', permanent: true },
      { source: '/our-sponsors/', destination: '/sponsors', permanent: true },
      { source: '/paragon', destination: '/resources#paragon', permanent: true },
      { source: '/paragon/', destination: '/resources#paragon', permanent: true },
      { source: '/rankings', destination: '/tournaments/rnrs-points', permanent: true },
      { source: '/rankings/', destination: '/tournaments/rnrs-points', permanent: true },
      // Remaining WordPress pages with a fixed tracker home (Track 1 spec §2 Group A).
      { source: '/deck-lists', destination: '/decklist/community', permanent: true },
      { source: '/deck-lists/', destination: '/decklist/community', permanent: true },
      { source: '/resources-old', destination: '/resources', permanent: true },
      { source: '/resources-old/', destination: '/resources', permanent: true },
      { source: '/home-2', destination: '/', permanent: true },
      { source: '/home-2/', destination: '/', permanent: true },
      // WordPress feed + sitemap surfaces (spec §1).
      { source: '/comments/feed', destination: '/articles/feed.xml', permanent: true },
      { source: '/comments/feed/', destination: '/articles/feed.xml', permanent: true },
      { source: '/category/:path*/feed', destination: '/articles/feed.xml', permanent: true },
      { source: '/category/:path*/feed/', destination: '/articles/feed.xml', permanent: true },
      // Nested WordPress pages under /resources-old/deck-lists/ — imported as
      // articles whose tracker slug equals the original page's last path segment.
      { source: '/resources-old/deck-lists', destination: '/decklist/community', permanent: true },
      { source: '/resources-old/deck-lists/', destination: '/decklist/community', permanent: true },
      { source: '/resources-old/deck-lists/:slug', destination: '/articles/:slug', permanent: true },
      { source: '/resources-old/deck-lists/:slug/', destination: '/articles/:slug', permanent: true },
      { source: '/wp-sitemap.xml', destination: '/sitemap.xml', permanent: true },
      { source: '/wp-sitemap-:rest', destination: '/sitemap.xml', permanent: true },
      { source: '/sitemap_index.xml', destination: '/sitemap.xml', permanent: true },
    ];
  },
};

module.exports = nextConfig;