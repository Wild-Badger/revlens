"use client";

import { PageHeader } from "@portfolio/ui/components/page-header";

interface Customer {
  id: string;
  name: string;
  domain: string | null;
  industry: string;
  companySize: string;
  country: string;
  acquisitionChannel: string;
  status: string;
  createdAt: string;
  convertedAt: string | null;
  churnedAt: string | null;
  subscriptions: { id: string; status: string; currentMrr: string }[];
  _count: { subscriptions: number; invoices: number; payments: number };
}

interface CustomersResponse {
  customers: Customer[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const statusColors: Record<string, string> = {
  active: "bg-green-500/10 text-green-500",
  churned: "bg-red-500/10 text-red-500",
  at_risk: "bg-yellow-500/10 text-yellow-500",
  prospect: "bg-blue-500/10 text-blue-500",
};

export default function AdminCustomersPage() {
  return (
    <>
      <PageHeader
        title="Customers"
        description="View and manage customer accounts"
      />

      <div className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Company
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Industry
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Size
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  MRR
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Subscriptions
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Country
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Created
                </th>
              </tr>
            </thead>
            <tbody id="customers-table-body">
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  Loading customers...
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
              const tbody = document.getElementById('customers-table-body');
              const info = document.getElementById('pagination-info');
              const prevBtn = document.getElementById('prev-btn');
              const nextBtn = document.getElementById('next-btn');
              let currentPage = 1;
              let totalPages = 1;

              async function loadCustomers(page) {
                const res = await fetch('/api/admin/customers?page=' + page);
                const data = await res.json();

                if (!data.customers || data.customers.length === 0) {
                  tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-muted-foreground">No customers found</td></tr>';
                  return;
                }

                const statusColors = {
                  active: 'bg-green-500/10 text-green-500',
                  churned: 'bg-red-500/10 text-red-500',
                  at_risk: 'bg-yellow-500/10 text-yellow-500',
                  prospect: 'bg-blue-500/10 text-blue-500'
                };

                tbody.innerHTML = data.customers.map(function(c) {
                  const statusClass = statusColors[c.status] || 'bg-gray-500/10 text-gray-500';
                  const totalMrr = c.subscriptions.reduce(function(sum, s) { return sum + parseFloat(s.currentMrr || 0); }, 0);
                  return '<tr class="border-b border-border hover:bg-muted/50">' +
                    '<td class="px-4 py-3"><div class="font-medium">' + c.name + '</div><div class="text-xs text-muted-foreground">' + (c.domain || '-') + '</div></td>' +
                    '<td class="px-4 py-3">' + c.industry + '</td>' +
                    '<td class="px-4 py-3">' + c.companySize + '</td>' +
                    '<td class="px-4 py-3"><span class="rounded ' + statusClass + ' px-2 py-0.5 text-xs">' + c.status + '</span></td>' +
                    '<td class="px-4 py-3">' + formatCurrency(totalMrr) + '</td>' +
                    '<td class="px-4 py-3">' + c._count.subscriptions + '</td>' +
                    '<td class="px-4 py-3">' + c.country + '</td>' +
                    '<td class="px-4 py-3">' + new Date(c.createdAt).toLocaleDateString() + '</td>' +
                    '</tr>';
                }).join('');

                currentPage = data.pagination.page;
                totalPages = data.pagination.totalPages;
                info.textContent = 'Page ' + currentPage + ' of ' + totalPages + ' (' + data.pagination.total + ' total)';
                prevBtn.disabled = currentPage <= 1;
                nextBtn.disabled = currentPage >= totalPages;
              }

              function formatCurrency(value) {
                return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
              }

              prevBtn.addEventListener('click', function() {
                if (currentPage > 1) loadCustomers(currentPage - 1);
              });

              nextBtn.addEventListener('click', function() {
                if (currentPage < totalPages) loadCustomers(currentPage + 1);
              });

              loadCustomers(1);
            })();
          `,
        }}
      />
    </>
  );
}