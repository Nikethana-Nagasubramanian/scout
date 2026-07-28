import type { Metadata } from "next";
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
      </body>
    </html>
  );
}
