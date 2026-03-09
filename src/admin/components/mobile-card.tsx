interface CardFieldProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

function CardField({ label, value, mono }: CardFieldProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[11px] text-foreground/40 font-medium">{label}</span>
      <span className={`text-[12px] text-foreground/80 text-right max-w-[60%] truncate font-medium ${mono ? "font-mono text-[11px]" : ""}`}>
        {value}
      </span>
    </div>
  );
}

interface MobileDataCardProps {
  header: React.ReactNode;
  fields: CardFieldProps[];
  actions?: React.ReactNode;
}

export function MobileDataCard({ header, fields, actions }: MobileDataCardProps) {
  return (
    <div className="rounded-2xl border border-white/[0.06] p-4" style={{
      background: "linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)",
    }}>
      <div className="mb-2.5 pb-2.5 border-b border-white/[0.06]">{header}</div>
      <div className="divide-y divide-white/[0.04]">
        {fields.map((f, i) => <CardField key={i} {...f} />)}
      </div>
      {actions && <div className="mt-3 pt-2.5 border-t border-white/[0.06]">{actions}</div>}
    </div>
  );
}
