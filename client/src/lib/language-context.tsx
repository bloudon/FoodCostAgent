import { createContext, useContext } from "react";
import type { Language } from "./marketing-translations";
import { translations } from "./marketing-translations";

interface LanguageContextValue {
  lang: Language;
  t: typeof translations.en;
}

export const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  t: translations.en,
});

export function useLanguage() {
  return useContext(LanguageContext);
}
