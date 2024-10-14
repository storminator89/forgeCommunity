import { Sidebar } from '@/components/Sidebar';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <main>
        <div>
          {children}
        </div>
      </main>
    </div>
  );
}