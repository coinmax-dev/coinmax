import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { adminLogin } from "./admin-api";
import AdminLoginPage from "./pages/admin-login";

const STORAGE_KEY_TOKEN = "coinmax_admin_token";
const STORAGE_KEY_USER = "coinmax_admin_user";

interface AdminAuthContextValue {
  isAdmin: boolean;
  adminUser: string | null;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue>({
  isAdmin: false,
  adminUser: null,
  login: async () => "Not initialized",
  logout: () => {},
});

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}

function getStored(): { token: string | null; user: string | null } {
  try {
    return {
      token: sessionStorage.getItem(STORAGE_KEY_TOKEN),
      user: sessionStorage.getItem(STORAGE_KEY_USER),
    };
  } catch {
    return { token: null, user: null };
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const stored = getStored();
  const [token, setToken] = useState<string | null>(stored.token);
  const [adminUser, setAdminUser] = useState<string | null>(stored.user);

  const login = useCallback(
    async (username: string, password: string): Promise<string | null> => {
      const result = await adminLogin(username, password);
      if (!result.success) {
        return result.error ?? "Login failed";
      }

      // Generate a simple session token
      const sessionToken = `admin_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      try {
        sessionStorage.setItem(STORAGE_KEY_TOKEN, sessionToken);
        sessionStorage.setItem(STORAGE_KEY_USER, username);
      } catch {
        // sessionStorage not available
      }

      setToken(sessionToken);
      setAdminUser(username);
      return null; // no error
    },
    []
  );

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY_TOKEN);
      sessionStorage.removeItem(STORAGE_KEY_USER);
    } catch {
      // sessionStorage not available
    }
    setToken(null);
    setAdminUser(null);
  }, []);

  const isAdmin = !!token && !!adminUser;

  const value: AdminAuthContextValue = {
    isAdmin,
    adminUser,
    login,
    logout,
  };

  if (!isAdmin) {
    return (
      <AdminAuthContext.Provider value={value}>
        <AdminLoginPage onLogin={login} />
      </AdminAuthContext.Provider>
    );
  }

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  );
}
