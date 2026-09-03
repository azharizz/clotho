import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://clotho.azharizzannada.chatgpt.site'),
  title: 'CLOTHO : Classy Looks for Occasion, Taste, History & Outfits',
  description: 'Deterministic outfit combinations, month planning, wear history, preferences, and low-resource recoloring.',
  openGraph: {
    title: 'CLOTHO : Classy Looks for Occasion, Taste, History & Outfits',
    description: 'Deterministic outfit combinations, month planning, wear history, preferences, and low-resource recoloring.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'CLOTHO wardrobe and outfit planning studio' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CLOTHO : Classy Looks for Occasion, Taste, History & Outfits',
    description: 'Deterministic outfit combinations, month planning, wear history, preferences, and low-resource recoloring.',
    images: ['/og.png'],
  },
  icons: {
    icon: '/branding/clotho-mark.png',
    shortcut: '/branding/clotho-mark.png',
    apple: '/branding/clotho-mark.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
