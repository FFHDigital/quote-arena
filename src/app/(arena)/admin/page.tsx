import type { Metadata } from "next";
import AdminConsole from "./AdminConsole";

export const metadata: Metadata = { title: "Admin | Quote Arena", robots: { index: false } };

export default function AdminPage() {
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-muted">Manage the insurer catalogue, run audits and review flagged verdicts.</p>
      </div>
      <AdminConsole />
    </div>
  );
}
