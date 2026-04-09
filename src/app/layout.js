import "./globals.css";

export const metadata = {
  title: "Paperclip Matrix Control Plane",
  description: "Remote AI Agent Worker Matrix - Dashboard & Orchestration",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
