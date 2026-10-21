import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Accentra AI",
  description: "Document-to-AutoCount accounting automation with a human review gate.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
