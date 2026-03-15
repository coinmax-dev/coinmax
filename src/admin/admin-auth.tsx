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
const STORAGE_KEY_ROLE = "coinmax_admin_role";

export type AdminRole = "superadmin" | "admin" | "support";

interface AdminAuthContextValue {
  isAdmin: boolean;
  adminUser: string | null;
  adminRole: AdminRole | null;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => void;
  hasPermission: (page: string) => boolean;
}

// Permission matrix
const PERMISSIONS: Record<AdminRole, string[]> = {
  superadmin: ["dashboard", "members", "referrals", "vaults", "nodes", "node-funds", "auth-codes", "performance", "logs", "contracts", "admins", "ai-accuracy", "providers"],
  admin: ["dashboard", "members", "referrals", "nodes", "performance", "auth-codes", "contracts-view", "logs", "ai-accuracy", "providers"],
  support: ["dashboard", "members", "referrals"],
};

const AdminAuthContext = createContext<AdminAuthContextValue>({
  isAdmin: false,
  adminUser: null,
  adminRole: null,
  login: async () => "Not initialized",
  logout: () => {},
  hasPermission: () => false,
});

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}

function getStored(): { token: string | null; user: string | null; role: AdminRole | null } {
  try {
    return {
      token: sessionStorage.getItem(STORAGE_KEY_TOKEN),
      user: sessionStorage.getItem(STORAGE_KEY_USER),
      role: sessionStorage.getItem(STORAGE_KEY_ROLE) as AdminRole | null,
    };
  } catch {
    return { token: null, user: null, role: null };
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const stored = getStored();
  const [token, setToken] = useState<string | null>(stored.token);
  const [adminUser, setAdminUser] = useState<string | null>(stored.user);
  const [adminRole, setAdminRole] = useState<AdminRole | null>(stored.role);

  const login = useCallback(
    async (username: string, password: string): Promise<string | null> => {
      const result = await adminLogin(username, password);
      if (!result.success) {
        return result.error ?? "Login failed";
      }

      const sessionToken = `admin_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const role = result.role as AdminRole;

      try {
        sessionStorage.setItem(STORAGE_KEY_TOKEN, sessionToken);
        sessionStorage.setItem(STORAGE_KEY_USER, username);
        sessionStorage.setItem(STORAGE_KEY_ROLE, role);
      } catch {}

      setToken(sessionToken);
      setAdminUser(username);
      setAdminRole(role);
      return null;
    },
    []
  );

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY_TOKEN);
      sessionStorage.removeItem(STORAGE_KEY_USER);
      sessionStorage.removeItem(STORAGE_KEY_ROLE);
    } catch {}
    setToken(null);
    setAdminUser(null);
    setAdminRole(null);
  }, []);

  const hasPermission = useCallback(
    (page: string) => {
      if (!adminRole) return false;
      return PERMISSIONS[adminRole]?.includes(page) ?? false;
    },
    [adminRole]
  );

  const isAdmin = !!token && !!adminUser;

  const value: AdminAuthContextValue = {
    isAdmin,
    adminUser,
    adminRole,
    login,
    logout,
    hasPermission,
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
