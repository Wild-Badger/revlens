select *, extract(epoch from paid_at-invoice_date)/86400 as days_to_payment
from {{ ref('stg_app__invoices') }}
