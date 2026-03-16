import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { Globe } from "lucide-react";

const LANGUAGES = [
  { code: "en", flag: "🇺🇸", short: "EN" },
  { code: "zh", flag: "🇨🇳", short: "中" },
  { code: "zh-TW", flag: "🇹🇼", short: "繁" },
  { code: "ja", flag: "🇯🇵", short: "日" },
  { code: "ko", flag: "🇰🇷", short: "한" },
  { code: "es", flag: "🇪🇸", short: "ES" },
  { code: "fr", flag: "🇫🇷", short: "FR" },
  { code: "de", flag: "🇩🇪", short: "DE" },
  { code: "ru", flag: "🇷🇺", short: "RU" },
  { code: "ar", flag: "🇸🇦", short: "AR" },
  { code: "pt", flag: "🇧🇷", short: "PT" },
  { code: "vi", flag: "🇻🇳", short: "VI" },
];

export default function LangSwitcher() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("en");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("coinmax-lang") || i18n.language || "en";
    setCurrent(saved);
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = (code: string) => {
    setCurrent(code);
    i18n.changeLanguage(code);
    localStorage.setItem("coinmax-lang", code);
    setOpen(false);
  };

  const currentLang = LANGUAGES.find(l => l.code === current) || LANGUAGES[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      >
        <Globe className="w-3.5 h-3.5" />
        <span>{currentLang.short}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 rounded-lg border border-border/60 bg-background/95 backdrop-blur-xl shadow-xl z-[100] py-1 max-h-72 overflow-y-auto">
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              onClick={() => select(lang.code)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                lang.code === current
                  ? "text-primary bg-primary/10 font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
            >
              <span className="text-sm">{lang.flag}</span>
              <span>{lang.short}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
