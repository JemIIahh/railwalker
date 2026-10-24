import '@fontsource-variable/bricolage-grotesque';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand, BrandMark } from '../components/brand';
import { Icon } from '../components/icons';
import { MobileMenu } from '../components/mobile-menu';
import { NavLink } from '../components/nav-link';
import { ConnectButton } from '../components/wallet/connect-button';
import { WalletModal } from '../components/wallet/wallet-modal';
import { WalletProvider } from '../components/wallet/wallet-provider';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/landing.css';
import './styles/explore.css';
import './styles/report.css';
import './styles/proof.css';
import './styles/how.css';

export const metadata: Metadata = {
  title: { default: 'Railwalker', template: '%s · Railwalker' },
  description: 'We test paid APIs on Celo with real money, and tell you what breaks.',
};

/** Set while the site reads pretend data, so nobody can mistake it for the real thing. */
const SAMPLE = process.env.RAILWALKER_SAMPLE === '1';

export default function RootLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <WalletProvider>
          <a className="skip" href="#main">
            Skip to the content
          </a>
          {SAMPLE ? (
            <div className="sample-banner" role="note">
              Sample data: pretend payments and made-up transactions, here only to look at the design
            </div>
          ) : null}
          <header className="site-header">
            <div className="container bar">
              <Brand />
              <nav className="main-nav" aria-label="Main">
                <NavLink href="/explore" also={['/run']}>
                  Explore
                </NavLink>
                <NavLink href="/proof">Proof</NavLink>
                <NavLink href="/how">How it works</NavLink>
              </nav>
              <div className="bar-end">
                <ConnectButton />
                <MobileMenu />
              </div>
            </div>
          </header>
          <main id="main">{children}</main>
          {modal}
          <WalletModal />
          <footer className="site-footer">
            <div className="container foot">
              <span className="foot-brand">
                <BrandMark size={32} /> Railwalker
              </span>
              <nav aria-label="Footer">
                <Link href="/explore">Explore</Link>
                <Link href="/proof">Proof</Link>
                <Link href="/how">How it works</Link>
                <a href="https://github.com/JemIIahh/railwalker" rel="noreferrer noopener">
                  Source <Icon name="arrowUpRight" size={14} style={{ display: 'inline', verticalAlign: '-2px' }} />
                </a>
              </nav>
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
