import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, User, AlertCircle, Loader2, Eye, EyeOff } from "lucide-react";

interface AdminLoginPageProps {
  onLogin: (username: string, password: string) => Promise<string | null>;
}

export default function AdminLoginPage({ onLogin }: AdminLoginPageProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
        <div className="text-center space-y-3">
          <img src="/logo-glass-pure.png" alt="Logo" className="mx-auto h-16" />
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              CoinMax <span className="text-primary">Admin</span>
            </h1>
            <p className="text-sm text-white/35 mt-1">
              {t("admin.loginSubtitle", "Sign in to the admin dashboard")}
            </p>
          </div>
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
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("admin.passwordPlaceholder", "Enter password")}
                required
                className="w-full h-11 pl-10 pr-10 rounded-xl text-sm text-white placeholder:text-white/25 outline-none transition-colors"
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
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-md transition-colors hover:bg-white/10"
                tabIndex={-1}
              >
                {showPassword
                  ? <EyeOff className="h-4 w-4 text-white/40" />
                  : <Eye className="h-4 w-4 text-white/40" />
                }
              </button>
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
            className="w-full h-11 rounded-xl text-sm font-semibold text-white transition-all active:translate-y-[1px] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, #0abab5 0%, #088f8b 100%)",
              boxShadow: "0 4px 15px rgba(10,186,181,0.25), inset 0 1px 0 rgba(255,255,255,0.1)",
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
