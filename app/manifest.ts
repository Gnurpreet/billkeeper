import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { id: '/', name: 'Billkeeper', short_name: 'Billkeeper', description: 'Receipts, in order.', start_url: '/', scope: '/', display: 'standalone', background_color: '#faf9f6', theme_color: '#253741', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] };
}
