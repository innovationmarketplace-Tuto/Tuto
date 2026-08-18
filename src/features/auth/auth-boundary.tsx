import { ConvexProviderWithAuth as GenericConvexProviderWithAuth, type ConvexReactClient } from 'convex/react';
import {
  ConvexAuthProvider as ConvexAuthProviderImpl,
  useAuthActions,
  useAuthToken,
  useConvexAuth as useConfiguredConvexAuth,
  type TokenStorage,
} from '@convex-dev/auth/react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in' | 'unconfigured';

export type AuthCredentials = {
  email: string;
  password: string;
  displayName?: string;
};

export type TutoAuth = {
  status: AuthStatus;
  error: Error | null;
  signIn: (credentials: AuthCredentials) => Promise<void>;
  signUp: (credentials: AuthCredentials) => Promise<void>;
  signOut: () => Promise<void>;
  /** Return the provider-issued Convex JWT. Never synthesize a token here. */
  fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>;
};

const AUTH_NOT_CONFIGURED = 'Authentication is not configured for this build.';

const unconfiguredAuth: TutoAuth = {
  status: 'unconfigured',
  error: new Error(AUTH_NOT_CONFIGURED),
  signIn: async () => {
    throw new Error(AUTH_NOT_CONFIGURED);
  },
  signUp: async () => {
    throw new Error(AUTH_NOT_CONFIGURED);
  },
  signOut: async () => undefined,
  fetchAccessToken: async () => null,
};

const AuthContext = createContext<TutoAuth>(unconfiguredAuth);

export function AuthProvider({ value, children }: { value?: TutoAuth; children: ReactNode }) {
  return <AuthContext.Provider value={value ?? unconfiguredAuth}>{children}</AuthContext.Provider>;
}

export function useTutoAuth(): TutoAuth {
  return useContext(AuthContext);
}

/**
 * The adapter expected by ConvexProviderWithAuth. Keep this tiny so a real
 * auth provider can replace `AuthProvider` without changing learner screens.
 */
export function useConvexAuthAdapter() {
  const auth = useTutoAuth();
  return {
    isLoading: auth.status === 'loading',
    isAuthenticated: auth.status === 'signed_in',
    fetchAccessToken: auth.fetchAccessToken,
  };
}

export function ConvexAuthProvider({
  client,
  auth,
  children,
}: {
  client: ConvexReactClient;
  auth?: TutoAuth;
  children: ReactNode;
}) {
  if (!auth) {
    return (
      <ConvexAuthProviderImpl
        client={client}
        storage={authTokenStorage}
        replaceURL={replaceAuthUrl}
      >
        <ConfiguredAuthBridge>{children}</ConfiguredAuthBridge>
      </ConvexAuthProviderImpl>
    );
  }
  return (
    <AuthProvider value={auth}>
      <GenericConvexProviderWithAuth client={client} useAuth={useConvexAuthAdapter}>
        {children}
      </GenericConvexProviderWithAuth>
    </AuthProvider>
  );
}

/** Bridge the approved @convex-dev/auth provider into the product boundary. */
function ConfiguredAuthBridge({ children }: { children: ReactNode }) {
  const state = useConfiguredConvexAuth();
  const actions = useAuthActions();
  const token = useAuthToken();
  const value = useMemo<TutoAuth>(() => ({
    status: state.isLoading ? 'loading' : state.isAuthenticated ? 'signed_in' : 'signed_out',
    error: null,
    signIn: async ({ email, password }) => {
      await actions.signIn('password', { flow: 'signIn', email, password });
    },
    signUp: async ({ email, password, displayName }) => {
      await actions.signIn('password', { flow: 'signUp', email, password, ...(displayName ? { name: displayName } : {}) });
    },
    signOut: actions.signOut,
    fetchAccessToken: async () => token,
  }), [actions, state.isAuthenticated, state.isLoading, token]);
  return <AuthProvider value={value}>{children}</AuthProvider>;
}

/** Convex Auth recommends secure storage for native token persistence. */
const authTokenStorage: TokenStorage = {
  getItem: (key) => Platform.OS === 'web' ? getWebStorage()?.getItem(key) ?? null : SecureStore.getItemAsync(key),
  setItem: (key, value) => Platform.OS === 'web' ? getWebStorage()?.setItem(key, value) : SecureStore.setItemAsync(key, value),
  removeItem: (key) => Platform.OS === 'web' ? getWebStorage()?.removeItem(key) : SecureStore.deleteItemAsync(key),
};

function getWebStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function replaceAuthUrl(relativeUrl: string): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.history.replaceState({}, '', relativeUrl);
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'Authentication failed. Check your details and try again.';
}

export const authNotConfiguredMessage = AUTH_NOT_CONFIGURED;
