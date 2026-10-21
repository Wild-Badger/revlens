select id as customer_id, name, domain, industry, company_size, country,
       acquisition_channel, created_at, converted_at, churned_at, status
from {{ source('app', 'customers') }}
