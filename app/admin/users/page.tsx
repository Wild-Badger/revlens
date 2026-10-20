"use client";

import { PageHeader } from "@portfolio/ui/components/page-header";

interface User {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
  _count: { accounts: number; sessions: number };
}

interface UsersResponse {
  users: User[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", { timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminUsersPage() {
  return (
    <>
      <PageHeader
        title="Users"
        description="Manage user accounts and roles"
      />

      <div className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Name
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Email
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Role
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Auth Providers
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Created
                </th>
              </tr>
            </thead>
            <tbody id="users-table-body">
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Loading users...
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <div id="pagination-info" className="text-sm text-muted-foreground">
           -
          </div>
          <div className="flex gap-2">
            <button
              id="prev-btn"
              className="rounded border border-border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50"
              disabled
            >
              Previous
            </button>
            <button
              id="next-btn"
              className="rounded border border-border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50"
              disabled
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `
            (async function() {
              const tbody = document.getElementById('users-table-body');
              const info = document.getElementById('pagination-info');
              const prevBtn = document.getElementById('prev-btn');
              const nextBtn = document.getElementById('next-btn');
              let currentPage = 1;
              let totalPages = 1;

              async function loadUsers(page) {
                const res = await fetch('/api/admin/users?page=' + page);
                const data = await res.json();

                if (!data.users || data.users.length === 0) {
                  tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-muted-foreground">No users found</td></tr>';
                  return;
                }

                tbody.innerHTML = data.users.map(function(u) {
                  return '<tr class="border-b border-border hover:bg-muted/50">' +
                    '<td class="px-4 py-3">' + (u.name || '-') + '</td>' +
                    '<td class="px-4 py-3">' + (u.email || '-') + '</td>' +
                    '<td class="px-4 py-3"><span class="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">' + u.role + '</span></td>' +
                    '<td class="px-4 py-3">' + u._count.accounts + '</td>' +
                    '<td class="px-4 py-3">' + new Date(u.createdAt).toLocaleDateString() + '</td>' +
                    '</tr>';
                }).join('');

                currentPage = data.pagination.page;
                totalPages = data.pagination.totalPages;
                info.textContent = 'Page ' + currentPage + ' of ' + totalPages + ' (' + data.pagination.total + ' total)';
                prevBtn.disabled = currentPage <= 1;
                nextBtn.disabled = currentPage >= totalPages;
              }

              prevBtn.addEventListener('click', function() {
                if (currentPage > 1) loadUsers(currentPage - 1);
              });

              nextBtn.addEventListener('click', function() {
                if (currentPage < totalPages) loadUsers(currentPage + 1);
              });

              loadUsers(1);
            })();
          `,
        }}
      />
    </>
  );
}