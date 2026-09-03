import type { Metadata } from "next";
import { Toaster } from "sonner";
import "@fontsource-variable/archivo";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/young-serif";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scout | Job search copilot",
  description: "A private local-first job search workflow for one candidate.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="main-shell">{children}</main>
        <Toaster
          position="top-right"
          theme="light"
          toastOptions={{
            className: "scout-toast",
            style: {
              fontFamily: "var(--font-interface)",
              border: "1px solid #dbdbdb",
              borderRadius: "8px",
              boxShadow: "0 12px 32px rgba(15, 18, 16, 0.14)",
            },
          }}
        />
      </body>
    </html>
  );
}
