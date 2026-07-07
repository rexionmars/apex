import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <App />
      <Toaster richColors position="bottom-right" />
    </ThemeProvider>
  </React.StrictMode>
);
