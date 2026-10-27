import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ToastProvider } from "./ui/Toast.tsx";
import "./styles/app.css";

// The hosted build (vite build --mode hosted, for bbg.prismcortex.net/register) never loads the
// in-browser database or its worker. Vite sets MODE itself, so no .env file is involved.
const { App } =
  import.meta.env.MODE === "hosted"
    ? await import("./HostedApp.tsx").then((m) => ({ App: m.HostedApp }))
    : await import("./App.tsx");

// "/" for the demo, "/register" when hosted under the store's site.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={basename}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
