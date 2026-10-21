select i.id as invoice_id, i.customer_id, i.subscription_id, i.amount, i.currency,
       i.status, i.invoice_date, i.paid_at, i.failed_at
from {{ source('app', 'invoices') }} i cross join {{ ref('stg_dataset') }} d
where i.invoice_date <= d.as_of
