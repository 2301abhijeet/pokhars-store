import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "POKHAR'S — A Taste of Bihar",
  description:
    "Discover POKHAR'S roasted makhana — a modern expression of Bihar's food heritage.",
  applicationName: "POKHAR'S",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
