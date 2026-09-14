import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api, setAccessToken, type AuthUser } from "../api/client";
import {
  INVITE_DISMISSED_KEY,
  SCREENS_SEEN_KEY,
  TOUR_MODE_KEY,
} from "../help/tutorialKeys";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  setup: (data: {
    email: string;
    password: string;
    display_name: string;
    club_name: string;
    club_short: string;
  }) => Promise<void>;
  updateUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Attempt silent refresh on mount
  useEffect(() => {
    api.auth
      .refresh()
      .then((data) => {
        setAccessToken(data.access_token);
        setUser(data.user);
      })
      .catch(() => {
        // Not authenticated — that's fine
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const resp = await api.auth.login(email, password);
    setAccessToken(resp.access_token);
    setUser(resp.user);
  }, []);

  const loginWithGoogle = useCallback(async (credential: string) => {
    const resp = await api.auth.loginWithGoogle(credential);
    setAccessToken(resp.access_token);
    setUser(resp.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // Ignore errors
    }
    setAccessToken(null);
    setUser(null);
    // Efface l'état du tutoriel : sur un poste partagé, l'utilisateur suivant
    // ne doit ni hériter des écrans déjà vus, ni retrouver le mode tutoriel
    // actif pour le mauvais public.
    try {
      localStorage.removeItem(SCREENS_SEEN_KEY);
    } catch {
      // Navigation privée ou stockage indisponible : sans conséquence.
    }
    try {
      sessionStorage.removeItem(TOUR_MODE_KEY);
      sessionStorage.removeItem(INVITE_DISMISSED_KEY);
    } catch {
      // Navigation privée ou stockage indisponible : sans conséquence.
    }
  }, []);

  const setup = useCallback(
    async (data: {
      email: string;
      password: string;
      display_name: string;
      club_name: string;
      club_short: string;
    }) => {
      const resp = await api.auth.setup(data);
      setAccessToken(resp.access_token);
      setUser(resp.user);
    },
    []
  );

  const updateUser = useCallback((u: AuthUser) => {
    setUser(u);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, loginWithGoogle, logout, setup, updateUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
