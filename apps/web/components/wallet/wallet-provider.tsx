'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPublicClient, http, parseAbi } from 'viem';
import { celo } from 'viem/chains';
import { ASSETS, type AssetSymbol } from '@railwalker/core';
import { CELO_ADD_CHAIN, dedupeWallets, isCelo, parseChainId, rankWallets, walletErrorText, type DiscoveredWallet } from '../../lib/wallet-core';

/** What a wallet gives a page: one method, and a way to hear about changes (EIP-1193). */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
}

interface Announcement {
  info: DiscoveredWallet;
  provider: Eip1193Provider;
}

export type WalletStatus = 'idle' | 'connecting' | 'connected';

export interface WalletApi {
  wallets: DiscoveredWallet[];
  status: WalletStatus;
  address: `0x${string}` | null;
  chainId: number | null;
  onCelo: boolean;
  wallet: DiscoveredWallet | null;
  balances: { symbol: AssetSymbol; atomic: bigint }[];
  error: string | null;
  modalOpen: boolean;
  /** The connected wallet's own provider, for the one thing it will be asked to do: sign a payment. */
  provider: Eip1193Provider | null;
  openConnect: () => void;
  closeConnect: () => void;
  connect: (wallet: DiscoveredWallet) => Promise<void>;
  disconnect: () => void;
  switchToCelo: () => Promise<void>;
  refreshBalances: () => void;
}

const Context = createContext<WalletApi | null>(null);
const FAVOURITE = 'rw:wallet';
const DOLLARS: AssetSymbol[] = ['USDC', 'USDT', 'USAT'];
const ERC20 = parseAbi(['function balanceOf(address owner) view returns (uint256)']);
const client = createPublicClient({ chain: celo, transport: http(CELO_ADD_CHAIN.rpcUrls[0]) });
const INJECTED: DiscoveredWallet = { uuid: 'injected', name: 'Browser wallet', rdns: 'injected', icon: '' };

export function useWallet(): WalletApi {
  const api = useContext(Context);
  if (api === null) throw new Error('useWallet is used outside WalletProvider');
  return api;
}

const readFavourite = (): string | null => {
  try {
    return window.localStorage.getItem(FAVOURITE);
  } catch {
    return null;
  }
};
const writeFavourite = (rdns: string | null): void => {
  try {
    if (rdns === null) window.localStorage.removeItem(FAVOURITE);
    else window.localStorage.setItem(FAVOURITE, rdns);
  } catch {
    /* private mode: it just will not be remembered */
  }
};

/**
 * Finds the wallets in the browser (EIP-6963), connects to the one the person picks, keeps its account and network up to date, and reads
 * what it holds in dollar tokens on Celo. It asks for the account and nothing else: no signature and no transaction, ever, from here.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const providers = useRef(new Map<string, Eip1193Provider>());
  const active = useRef<{ rdns: string; provider: Eip1193Provider; off: () => void } | null>(null);
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [status, setStatus] = useState<WalletStatus>('idle');
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [wallet, setWallet] = useState<DiscoveredWallet | null>(null);
  const [balances, setBalances] = useState<{ symbol: AssetSymbol; atomic: bigint }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [favourite, setFavourite] = useState<string | null>(null);

  const forget = useCallback(() => {
    active.current?.off();
    active.current = null;
    setStatus('idle');
    setAddress(null);
    setChainId(null);
    setWallet(null);
    setBalances([]);
  }, []);

  const attach = useCallback(
    (info: DiscoveredWallet, provider: Eip1193Provider, account: string, chain: number | null) => {
      active.current?.off();
      const onAccounts = (accounts: unknown) => {
        const next = Array.isArray(accounts) ? (accounts[0] as string | undefined) : undefined;
        if (next) setAddress(next as `0x${string}`);
        else forget();
      };
      const onChain = (value: unknown) => setChainId(parseChainId(value));
      provider.on?.('accountsChanged', onAccounts);
      provider.on?.('chainChanged', onChain);
      provider.on?.('disconnect', forget);
      active.current = {
        rdns: info.rdns,
        provider,
        off: () => {
          provider.removeListener?.('accountsChanged', onAccounts);
          provider.removeListener?.('chainChanged', onChain);
          provider.removeListener?.('disconnect', forget);
        },
      };
      setWallet(info);
      setAddress(account as `0x${string}`);
      setChainId(chain);
      setStatus('connected');
    },
    [forget],
  );

  // wallets announce themselves; some only after the page has loaded
  useEffect(() => {
    const found: Announcement[] = [];
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Announcement>).detail;
      if (!detail?.info?.rdns || !detail.provider) return;
      providers.current.set(detail.info.rdns, detail.provider);
      found.push(detail);
      setWallets(dedupeWallets(found.map((f) => f.info)));
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const legacy = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
    const timer = setTimeout(() => {
      if (legacy && providers.current.size === 0) {
        providers.current.set(INJECTED.rdns, legacy);
        setWallets([INJECTED]);
      }
    }, 400);
    setFavourite(readFavourite());
    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      clearTimeout(timer);
    };
  }, []);

  // coming back: if the wallet used last time already trusts this site, reconnect without asking
  useEffect(() => {
    if (status !== 'idle' || favourite === null) return;
    const info = wallets.find((w) => w.rdns === favourite);
    const provider = providers.current.get(favourite);
    if (!info || !provider) return;
    let cancelled = false;
    void (async () => {
      try {
        const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
        if (cancelled || !accounts[0]) return;
        const chain = parseChainId(await provider.request({ method: 'eth_chainId' }));
        if (!cancelled) attach(info, provider, accounts[0], chain);
      } catch {
        /* it will just show as not connected */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallets, favourite, status, attach]);

  const connect = useCallback(
    async (info: DiscoveredWallet) => {
      const provider = providers.current.get(info.rdns);
      if (!provider) return;
      setError(null);
      setStatus('connecting');
      try {
        const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
        if (!accounts[0]) throw new Error('no account');
        const chain = parseChainId(await provider.request({ method: 'eth_chainId' }));
        attach(info, provider, accounts[0], chain);
        writeFavourite(info.rdns);
        setFavourite(info.rdns);
      } catch (e) {
        setStatus('idle');
        setError(walletErrorText(e));
      }
    },
    [attach],
  );

  const disconnect = useCallback(() => {
    forget();
    writeFavourite(null);
    setFavourite(null);
  }, [forget]);

  const switchToCelo = useCallback(async () => {
    const provider = active.current?.provider;
    if (!provider) return;
    setError(null);
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CELO_ADD_CHAIN.chainId }] });
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code === 4902) {
        try {
          await provider.request({ method: 'wallet_addEthereumChain', params: [CELO_ADD_CHAIN] });
          return;
        } catch (inner) {
          setError(walletErrorText(inner));
          return;
        }
      }
      setError(walletErrorText(e));
    }
  }, []);

  const refreshBalances = useCallback(() => {
    if (!address) return;
    void Promise.all(
      DOLLARS.map(async (symbol) => ({ symbol, atomic: (await client.readContract({ address: ASSETS[symbol].address as `0x${string}`, abi: ERC20, functionName: 'balanceOf', args: [address] })) as bigint })),
    )
      .then(setBalances)
      .catch(() => setBalances([]));
  }, [address]);

  useEffect(() => {
    if (status !== 'connected') return;
    refreshBalances();
    const timer = setInterval(() => !document.hidden && refreshBalances(), 45_000);
    return () => clearInterval(timer);
  }, [status, refreshBalances]);

  const api = useMemo<WalletApi>(
    () => ({
      wallets: rankWallets(wallets, favourite),
      status,
      address,
      chainId,
      onCelo: isCelo(chainId),
      wallet,
      balances,
      error,
      modalOpen,
      provider: active.current?.provider ?? null,
      openConnect: () => {
        setError(null);
        setModalOpen(true);
      },
      closeConnect: () => setModalOpen(false),
      connect,
      disconnect,
      switchToCelo,
      refreshBalances,
    }),
    [wallets, favourite, status, address, chainId, wallet, balances, error, modalOpen, connect, disconnect, switchToCelo, refreshBalances],
  );

  return <Context.Provider value={api}>{children}</Context.Provider>;
}
