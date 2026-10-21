{% snapshot customer_attributes %}
{{ config(strategy='check', unique_key='entity_key', check_cols=['name','domain','industry','company_size','country','acquisition_channel','status'], hard_deletes='new_record') }}
select d.source_id || ':' || c.customer_id as entity_key, d.source_id, d.as_of as source_as_of,
       c.* from {{ ref('stg_app__customers') }} c cross join {{ ref('stg_dataset') }} d
{% endsnapshot %}
