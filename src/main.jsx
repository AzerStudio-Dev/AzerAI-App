import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import StartupGate from "./components/StartupGate";
import { LanguageProvider } from "./LanguageContext";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LanguageProvider>
      <StartupGate>
        <App />
      </StartupGate>
    </LanguageProvider>
  </React.StrictMode>
);
