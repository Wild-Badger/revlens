import type { CustomerListItem } from "./customers";

export type CustomerFilters = {
  search?: string;
  status?: string;
  paymentStatus?: string;
  churnRisk?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

/** Plan membership is resolved from active intervals before applying these list filters. */
export function filterCustomerList(customers: CustomerListItem[], options: CustomerFilters = {}) {
  const { search, status, paymentStatus, churnRisk, sortBy = "name", sortOrder = "asc" } = options;
  const q = search?.toLowerCase();
  return customers.filter((customer) =>
    (!q || [customer.name, customer.domain, customer.industry, customer.country].some((value) => value?.toLowerCase().includes(q))) &&
    (!status || customer.status === status) &&
    (!paymentStatus || customer.paymentStatus === paymentStatus) &&
    (!churnRisk || customer.churnRisk === churnRisk)
  ).sort((a, b) => {
    const aValue = a[sortBy as keyof CustomerListItem] ?? "";
    const bValue = b[sortBy as keyof CustomerListItem] ?? "";
    const order = typeof aValue === "number" && typeof bValue === "number"
      ? aValue - bValue : String(aValue).localeCompare(String(bValue));
    return sortOrder === "asc" ? order : -order;
  });
}
