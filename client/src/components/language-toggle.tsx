import { Button } from "@/components/ui/button";
import { useAppLanguage } from "@/lib/language-context";

export function LanguageToggle() {
  const { lang, setLang } = useAppLanguage();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setLang(lang === "en" ? "es" : "en")}
      data-testid="button-language-toggle"
      title={lang === "en" ? "Switch to Spanish" : "Cambiar a inglés"}
      className="font-semibold text-xs"
    >
      <span className="w-5 text-center leading-none">{lang === "en" ? "ES" : "EN"}</span>
      <span className="sr-only">Toggle language</span>
    </Button>
  );
}
