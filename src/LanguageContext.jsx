import React, { createContext, useContext, useState, useEffect } from "react";
import { translations } from "./translations";

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState("az");
  const [isInitialized, setIsInitialized] = useState(false);

  const detectLanguage = async () => {
    let savedLang = null;

    // 1. Check Electron settings
    try {
      if (window.livekit?.getSettings) {
        const settings = await window.livekit.getSettings();
        savedLang = settings?.APP_LANG;
      }
    } catch (e) {
      console.warn("Failed to get settings from electron:", e);
    }

    // 2. Check localStorage if Electron failed or returned empty
    if (!savedLang) {
      try {
        const saved = localStorage.getItem("livekit_settings");
        if (saved) {
          const parsed = JSON.parse(saved);
          savedLang = parsed?.APP_LANG;
        }
      } catch (e) {}
    }

    // 3. Fallback to system language detection
    if (!savedLang) {
      try {
        let locale = null;
        if (window.livekit?.getSystemLanguage) {
          locale = await window.livekit.getSystemLanguage();
        } else {
          locale = navigator.language;
        }
        
        if (locale) {
          const clean = locale.toLowerCase();
          if (clean.startsWith("az")) {
            savedLang = "az";
          } else if (clean.startsWith("tr")) {
            savedLang = "tr";
          } else {
            savedLang = "en";
          }
        }
      } catch (e) {
        console.warn("Failed to detect system language:", e);
      }
    }

    // 4. Default fallback
    if (!savedLang) {
      savedLang = "az";
    }

    setLanguageState(savedLang);
    setIsInitialized(true);
  };

  useEffect(() => {
    detectLanguage();

    if (window.livekit?.onLanguageChanged) {
      const unsubscribe = window.livekit.onLanguageChanged((newLang) => {
        if (newLang === "az" || newLang === "tr" || newLang === "en") {
          setLanguageState(newLang);
        }
      });
      return unsubscribe;
    }
  }, []);

  const changeLanguage = async (newLang) => {
    if (newLang !== "az" && newLang !== "tr" && newLang !== "en") return;
    
    setLanguageState(newLang);

    // Save to settings immediately
    try {
      if (window.livekit?.getSettings && window.livekit?.saveSettings) {
        const settings = await window.livekit.getSettings();
        await window.livekit.saveSettings({
          ...settings,
          APP_LANG: newLang
        });
      } else {
        const saved = localStorage.getItem("livekit_settings");
        let settings = {};
        if (saved) {
          try {
            settings = JSON.parse(saved);
          } catch (e) {}
        }
        settings.APP_LANG = newLang;
        localStorage.setItem("livekit_settings", JSON.stringify(settings));
      }
    } catch (e) {
      console.error("Failed to save language setting:", e);
    }
  };

  const t = (key, ...args) => {
    const langObj = translations[language] || translations["az"];
    const val = langObj[key] || translations["az"][key] || key;
    if (typeof val === "function") {
      return val(...args);
    }
    return val;
  };

  return (
    <LanguageContext.Provider value={{ language, changeLanguage, t, isInitialized }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
