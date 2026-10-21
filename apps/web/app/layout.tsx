import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Railwalker',
  description: 'Pays every toll on Celo’s rails and shows you what’s broken.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="bar">
          <a className="brand" href="/">
            Railwalker
          </a>
          <nav>
            <a href="/methodology">Methodology</a>
            <a href="https://github.com/JemIIahh/railwalker">Source</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
