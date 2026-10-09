import { QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { telegram } from "./telegram";
import { TelegramSessionCache } from "./lib/session-cache";

telegram.ready();
telegram.expand();
telegram.applyTheme();

function SessionQueryBoundary() {
  const [cache] = useState(() => new TelegramSessionCache(telegram.initData));
  const [revision, setRevision] = useState(cache.key);
  useEffect(() => {
    const check = () => {
      if (cache.update(telegram.initData)) setRevision(cache.key);
    };
    const timer = window.setInterval(check, 500);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [cache]);
  return (
    <QueryClientProvider key={revision} client={cache.client}>
      <App />
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SessionQueryBoundary />
  </React.StrictMode>,
);
