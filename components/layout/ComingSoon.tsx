import { Header } from "./Header";
import { Sparkles } from "lucide-react";

interface Props { title: string; subtitle?: string; description?: string; }

export function ComingSoon({ title, subtitle, description }: Props) {
  return (
    <div>
      <Header title={title} subtitle={subtitle} />
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5" style={{ background: "var(--blue-bg)" }}>
          <Sparkles size={24} style={{ color: "var(--blue)" }} />
        </div>
        <h2 className="text-base font-bold mb-2" style={{ color: "var(--text)" }}>{title}</h2>
        <p className="text-sm text-center max-w-sm" style={{ color: "var(--text-3)" }}>
          {description ?? "Este módulo está en construcción. Estará disponible en la próxima fase."}
        </p>
        <div className="mt-4 px-4 py-1.5 rounded-xl text-xs font-semibold" style={{ background: "var(--blue-bg)", color: "var(--blue)" }}>
          Próximamente
        </div>
      </div>
    </div>
  );
}
