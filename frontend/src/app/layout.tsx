import "./globals.css";

export const metadata = {
  title: "SFRA AI Agent",
  description: "Gap analysis and FSD generator for SFRA requirements.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
