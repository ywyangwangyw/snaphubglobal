export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The /mobile pages manage their own chrome (no public Navbar/Footer)
  return <>{children}</>;
}
