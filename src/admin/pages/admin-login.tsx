import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, User, AlertCircle, Loader2 } from "lucide-react";

interface AdminLoginPageProps {
  onLogin: (username: string, password: string) => Promise<string | null>;
}

export default function AdminLoginPage({ onLogin }: AdminLoginPageProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const err = await onLogin(username, password);
      if (err) setError(err);
    } catch {
      setError(t("admin.loginFailed", "Login failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "#0a0f0d" }}
    >
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div
            className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, rgba(10,186,181,0.2) 0%, rgba(10,186,181,0.05) 100%)",
              border: "1px solid rgba(10,186,181,0.3)",
            }}
          >
            <Lock className="h-6 w-6" style={{ color: "#0abab5" }} />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            CoinMax Admin
          </h1>
          <p className="text-sm text-white/40">
            {t("admin.loginSubtitle", "Sign in to the admin dashboard")}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-white/50 uppercase tracking-wider">
              {t("admin.username", "Username")}
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("admin.usernamePlaceholder", "Enter username")}
                required
                className="w-full h-11 pl-10 pr-4 rounded-xl text-sm text-white placeholder:text-white/25 outline-none transition-colors"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
                onFocus={(e) =>
                  (e.target.style.borderColor = "rgba(10,186,181,0.4)")
                }
                onBlur={(e) =>
                  (e.target.style.borderColor = "rgba(255,255,255,0.08)")
                }
              />
            </div>
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-white/50 uppercase tracking-wider">
              {t("admin.password", "Password")}
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("admin.passwordPlaceholder", "Enter password")}
                required
                className="w-full h-11 pl-10 pr-4 rounded-xl text-sm text-white placeholder:text-white/25 outline-none transition-colors"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
                onFocus={(e) =>
                  (e.target.style.borderColor = "rgba(10,186,181,0.4)")
                }
                onBlur={(e) =>
                  (e.target.style.borderColor = "rgba(255,255,255,0.08)")
                }
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <span className="text-xs text-red-400">{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full h-11 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background:
                "linear-gradient(135deg, #0abab5 0%, #088f8b 100%)",
            }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("admin.loggingIn", "Signing in...")}
              </span>
            ) : (
              t("admin.loginButton", "Sign In")
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
