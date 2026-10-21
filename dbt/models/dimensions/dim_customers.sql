-- Attribute versions are observation history, not inferred historical business attributes.
select * from {{ ref('customer_attributes') }}
