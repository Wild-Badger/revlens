select p.id as event_id, p.customer_id, p.user_id, p.event_name, p.properties, p.timestamp
from {{ source('app', 'product_events') }} p cross join {{ ref('stg_dataset') }} d
where p.timestamp <= d.as_of
