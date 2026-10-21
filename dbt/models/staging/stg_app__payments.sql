select p.id as payment_id, p.invoice_id, p.customer_id, p.amount, p.status,
       p.payment_method, p.processed_at
from {{ source('app', 'payments') }} p cross join {{ ref('stg_dataset') }} d
where p.processed_at <= d.as_of
