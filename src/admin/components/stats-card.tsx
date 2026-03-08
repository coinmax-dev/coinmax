import type { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: {
    value: number;
    positive: boolean;
  };
}

export function StatsCard({ title, value, subtitle, icon: Icon, trend }: StatsCardProps) {
  return (
    <div
      className="rounded-2xl p-5 border border-border/30 backdrop-blur-sm"
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.12), 0 0 1px rgba(255,255,255,0.05) inset",
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-foreground/40 uppercase tracking-wider">
          {title}
        </span>
        {Icon && (
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/15">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        )}
      </div>

      <div className="text-2xl font-bold text-foreground tracking-tight">
        {value}
      </div>

      {(subtitle || trend) && (
        <div className="flex items-center gap-2 mt-2">
          {trend && (
            <span
              className={`text-xs font-semibold ${
                trend.positive ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {trend.positive ? "+" : ""}
              {trend.value}%
            </span>
          )}
          {subtitle && (
            <span className="text-xs text-foreground/35">{subtitle}</span>
          )}
        </div>
      )}
    </div>
  );
}
