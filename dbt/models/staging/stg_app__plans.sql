select id as plan_id, name as plan_name, billing_interval, base_price, seat_price, created_at
from {{ source('app', 'plans') }}
