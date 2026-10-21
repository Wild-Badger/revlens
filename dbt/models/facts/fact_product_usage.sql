select customer_id,timestamp::date as usage_date,count(*) as total_events,
       count(distinct user_id) as active_users
from {{ ref('stg_app__product_events') }} group by 1,2
