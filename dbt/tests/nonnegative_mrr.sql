select * from {{ ref('fact_customer_monthly') }} where mrr<0 or opening_mrr<0
