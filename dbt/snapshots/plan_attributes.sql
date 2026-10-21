{% snapshot plan_attributes %}
{{ config(strategy='check', unique_key='entity_key', check_cols=['plan_name','billing_interval','base_price','seat_price'], hard_deletes='new_record') }}
select d.source_id || ':' || p.plan_id as entity_key, d.source_id, d.as_of as source_as_of,
       p.* from {{ ref('stg_app__plans') }} p cross join {{ ref('stg_dataset') }} d
{% endsnapshot %}
