"use client";

import { PageHeader } from "@portfolio/ui/components/page-header";

interface Subscription {
  id: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  billingInterval: string;
  currentMrr: string;
  seats: number;
  customer: { id: string; name: string; domain: string | null };
  plan: { id: string; name: string; billingInterval: string };
}

interface SubscriptionsResponse {
  subscriptions: Subscription[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function formatCurrency(value: string | number) {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(num);
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", { timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const statusColors: Record<string, string> = {
  active: "bg-green-500/10 text-green-500",
  cancelled: "bg-red-500/10 text-red-500",
  paused: "bg-yellow-500/10 text-yellow-500",
  expired: "bg-gray-500/10 text-gray-500",
};

export default function AdminSubscriptionsPage() {
  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="View and manage customer subscriptions"
      />

      <div className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Customer
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Plan
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  MRR
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Seats
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Billing
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Started
                </th>
              </tr>
            </thead>
            <tbody id="subscriptions-table-body">
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Loading subscriptions...
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
              const tbody = document.getElementById('subscriptions-table-body');
              const info = document.getElementById('pagination-info');
              const prevBtn = document.getElementById('prev-btn');
              const nextBtn = document.getElementById('next-btn');
              let currentPage = 1;
              let totalPages = 1;

              async function loadSubscriptions(page) {
                const res = await fetch('/api/admin/subscriptions?page=' + page);
                const data = await res.json();

                if (!data.subscriptions || data.subscriptions.length === 0) {
                  tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-muted-foreground">No subscriptions found</td></tr>';
                  return;
                }

                const statusColors = {
                  active: 'bg-green-500/10 text-green-500',
                  cancelled: 'bg-red-500/10 text-red-500',
                  paused: 'bg-yellow-500/10 text-yellow-500',
                  expired: 'bg-gray-500/10 text-gray-500'
                };

                tbody.innerHTML = data.subscriptions.map(function(s) {
                  const statusClass = statusColors[s.status] || 'bg-gray-500/10 text-gray-500';
                  return '<tr class="border-b border-border hover:bg-muted/50">' +
                    '<td class="px-4 py-3"><div class="font-medium">' + s.customer.name + '</div><div class="text-xs text-muted-foreground">' + (s.customer.domain || '-') + '</div></td>' +
                    '<td class="px-4 py-3">' + s.plan.name + '</td>' +
                    '<td class="px-4 py-3"><span class="rounded ' + statusClass + ' px-2 py-0.5 text-xs">' + s.status + '</span></td>' +
                    '<td class="px-4 py-3">' + formatCurrency(s.currentMrr) + '</td>' +
                    '<td class="px-4 py-3">' + s.seats + '</td>' +
                    '<td class="px-4 py-3">' + s.billingInterval + '</td>' +
                    '<td class="px-4 py-3">' + new Date(s.startedAt).toLocaleDateString() + '</td>' +
                    '</tr>';
                }).join('');

                currentPage = data.pagination.page;
                totalPages = data.pagination.totalPages;
                info.textContent = 'Page ' + currentPage + ' of ' + totalPages + ' (' + data.pagination.total + ' total)';
                prevBtn.disabled = currentPage <= 1;
                nextBtn.disabled = currentPage >= totalPages;
              }

              function formatCurrency(value) {
                const num = parseFloat(value);
                return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
              }

              prevBtn.addEventListener('click', function() {
                if (currentPage > 1) loadSubscriptions(currentPage - 1);
              });

              nextBtn.addEventListener('click', function() {
                if (currentPage < totalPages) loadSubscriptions(currentPage + 1);
              });

              loadSubscriptions(1);
            })();
          `,
        }}
      />
    </>
  );
}