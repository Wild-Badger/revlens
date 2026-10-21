select id, source_id, source_name, as_of, imported_at, history_start,
       history_complete, revision, analytics_revision, pipeline_status, currency
from {{ source('app', 'dataset_metadata') }} where id = 'local'
