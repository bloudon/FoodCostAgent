import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { Language } from "./marketing-translations";
import { translations } from "./marketing-translations";
import { appTranslations, type AppLanguage, type AppT } from "./app-translations";

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

interface AppLanguageContextValue {
  lang: AppLanguage;
  setLang: (lang: AppLanguage) => void;
  t: AppT;
}

export const AppLanguageContext = createContext<AppLanguageContextValue>({
  lang: "en",
  setLang: () => {},
  t: appTranslations.en,
});

function getInitialLang(): AppLanguage {
  try {
    const stored = localStorage.getItem("fnb_lang");
    if (stored === "en" || stored === "es") return stored;
  } catch {}
  return "en";
}

export function AppLanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<AppLanguage>(getInitialLang);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.preferredLanguage === "en" || data?.preferredLanguage === "es") {
          setLangState(data.preferredLanguage);
        }
      })
      .catch(() => {});
  }, []);

  function setLang(newLang: AppLanguage) {
    setLangState(newLang);
    try {
      localStorage.setItem("fnb_lang", newLang);
    } catch {}
    fetch("/api/auth/me/language", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ preferredLanguage: newLang }),
    }).catch(() => {});
  }

  const t: AppT = lang === "en" ? appTranslations.en : appTranslations.es;

  return (
    <AppLanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </AppLanguageContext.Provider>
  );
}

export function useAppLanguage(): AppLanguageContextValue {
  return useContext(AppLanguageContext);
}
