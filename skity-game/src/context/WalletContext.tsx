/**
 * Wallet Context - Manages Lace wallet connection and Midnight providers
 */

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import '@midnight-ntwrk/dapp-connector-api';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { GamePrivateState } from '@framed/contract';

export type MidnightGameProviders = MidnightProviders<string, string, GamePrivateState>;

interface WalletContextType {
  isConnected: boolean;
  walletAddress: string | null;
  shieldedAddress: string | null;
  connecting: boolean;
  providers: MidnightGameProviders | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
};

interface WalletProviderProps {
  children: React.ReactNode;
}

export const WalletProvider: React.FC<WalletProviderProps> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [shieldedAddress, setShieldedAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectedAPI, setConnectedAPI] = useState<ConnectedAPI | null>(null);

  // ZK Config Provider (browser-compatible)
  const zkConfigProvider = useMemo(
    () => new FetchZkConfigProvider('/zk-keys', fetch.bind(window)),
    []
  );

  // Proof provider - use wallet's proof server if available
  const proofProvider = useMemo(() => {
    const proofServerUri = 'http://localhost:6300';
    return httpClientProofProvider(proofServerUri, zkConfigProvider);
  }, [zkConfigProvider]);

  // Private state provider
  const privateStateProvider = useMemo(
    () => levelPrivateStateProvider<string, GamePrivateState>({ 
      privateStateStoreName: 'framed-game-private-state',
      signingKeyStoreName: 'framed-signing-keys',
      privateStoragePasswordProvider: () => 'framed-game-password-2024',
      accountId: shieldedAddress || 'default-account'
    }),
    [shieldedAddress]
  );

  // Public data provider
  const publicDataProvider = useMemo(
    () => indexerPublicDataProvider(
      'https://indexer.testnet.midnight.network/api/v1/graphql',
      'wss://indexer.testnet.midnight.network/api/v1/graphql'
    ),
    []
  );

  // Wallet provider (wraps Lace API)
  const walletProvider = useMemo(() => {
    if (!connectedAPI) return null;
    
    return {
      getCoinPublicKey: () => {
        // ConnectedAPI doesn't expose this directly, use a placeholder
        return walletAddress || '';
      },
      getEncryptionPublicKey: () => {
        // ConnectedAPI doesn't expose this directly, use a placeholder
        return '';
      },
      balanceTx: async (tx: any, ttl?: Date) => {
        // Use Lace's balanceUnsealedTransaction for contract calls
        const result = await connectedAPI.balanceUnsealedTransaction(tx);
        return result.tx;
      },
    };
  }, [connectedAPI, walletAddress]);

  // Midnight provider (wraps Lace API)
  const midnightProvider = useMemo(() => {
    if (!connectedAPI) return null;
    
    return {
      submitTx: async (tx: any): Promise<string> => {
        try {
          // submitTransaction returns void, but we need to return a transaction ID
          // In practice, the transaction is submitted and we can track it via indexer
          await connectedAPI.submitTransaction(tx);
          // Return a placeholder ID - in production, query indexer for actual tx ID
          return 'tx-submitted-' + Date.now();
        } catch (error) {
          console.error('Failed to submit transaction:', error);
          throw error;
        }
      },
    };
  }, [connectedAPI]);

  // Combined providers
  const providers = useMemo<MidnightGameProviders | null>(() => {
    if (!walletProvider || !midnightProvider) return null;
    
    return {
      privateStateProvider,
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      walletProvider: walletProvider as any,
      midnightProvider: midnightProvider as any,
    } as MidnightGameProviders;
  }, [privateStateProvider, publicDataProvider, zkConfigProvider, proofProvider, walletProvider, midnightProvider]);

  // Connect to Lace wallet
  const connect = useCallback(async () => {
    if (connecting || isConnected) return;
    
    setConnecting(true);
    try {
      if (!window.midnight?.mnLace) {
        throw new Error('Lace wallet not found. Please install the Lace extension.');
      }

      const wallet = await window.midnight.mnLace;
      const api = await wallet.connect('undeployed');
      
      const addresses = await api.getShieldedAddresses();
      const connectionStatus = await api.getConnectionStatus();
      
      if (connectionStatus) {
        setConnectedAPI(api);
        setShieldedAddress(addresses.shieldedAddress);
        setWalletAddress(addresses.shieldedAddress); // Use shielded address as wallet address
        setIsConnected(true);
        console.log('✅ Connected to Lace wallet:', addresses.shieldedAddress);
      }
    } catch (error) {
      console.error('❌ Failed to connect to wallet:', error);
      throw error;
    } finally {
      setConnecting(false);
    }
  }, [connecting, isConnected]);

  // Disconnect wallet
  const disconnect = useCallback(() => {
    setIsConnected(false);
    setWalletAddress(null);
    setShieldedAddress(null);
    setConnectedAPI(null);
    console.log('🔌 Disconnected from wallet');
  }, []);

  // Auto-connect if previously authorized
  useEffect(() => {
    let cancelled = false;
    
    (async () => {
      try {
        const api = (window as any)?.midnight?.mnLace;
        if (api && typeof api.isEnabled === 'function') {
          const enabled = await api.isEnabled();
          if (enabled && !cancelled && !isConnected) {
            await connect();
          }
        }
      } catch (err) {
        console.warn('Auto-connect failed:', err);
      }
    })();
    
    return () => {
      cancelled = true;
    };
  }, [connect, isConnected]);

  const value: WalletContextType = {
    isConnected,
    walletAddress,
    shieldedAddress,
    connecting,
    providers,
    connect,
    disconnect,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};
