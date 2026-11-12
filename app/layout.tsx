import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Billkeeper — Receipts, in order.', description: 'Capture receipts, review expenses, and close reports.', manifest: '/manifest.webmanifest', appleWebApp: { capable: true, title: 'Billkeeper', statusBarStyle: 'default' }, icons: { icon: '/icon.svg', apple: '/icon-192.png' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#253741' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
