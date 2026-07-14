import { useI18n } from "@/i18n/LanguageProvider";
import { cn } from "@/lib/utils";
import type { Lang } from "@/i18n/translations";

const OPTIONS: Lang[] = ["th", "en"];

export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className={cn("inline-flex rounded-lg border border-border bg-background p-0.5", className)}>
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLang(option)}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
            lang === option
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t(`lang.${option}`)}
        </button>
      ))}
    </div>
  );
}
