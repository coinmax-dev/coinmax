import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { BridgeWidget } from "thirdweb/react";
import { getThirdwebClient } from "@/lib/thirdweb";
import { bsc } from "thirdweb/chains";

export default function ProfileSwapPage() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();

  let client: ReturnType<typeof getThirdwebClient> | null = null;
  try {
    client = getThirdwebClient();
  } catch {
    client = null;
  }

  return (
    <div className="min-h-screen pb-24 lg:pb-8 lg:pt-4" style={{ background: "#0a0a0a" }}>
      <div className="px-4 pt-3 pb-4">
        <div className="flex items-center justify-center relative mb-4 lg:justify-start">
          <button
            onClick={() => navigate("/profile")}
            className="absolute left-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5 transition-colors lg:hidden"
          >
            <ArrowLeft className="h-5 w-5 text-white/80" />
          </button>
          <h1 className="text-[17px] font-bold tracking-wide">{t("profile.swap")}</h1>
        </div>
      </div>

      <div className="px-4">
        {client ? (
          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: "1px solid rgba(74, 222, 128, 0.15)", background: "rgba(10, 15, 10, 0.6)" }}
          >
            <BridgeWidget
              client={client}
              chain={bsc}
              theme="dark"
            />
          </div>
        ) : (
          <div
            className="rounded-2xl p-8 text-center"
            style={{ border: "1px solid rgba(74, 222, 128, 0.15)", background: "rgba(10, 15, 10, 0.6)" }}
          >
            <p className="text-[13px] text-white/40">{t("profile.swapUnavailable")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
