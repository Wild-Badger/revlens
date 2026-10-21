with changes as (
 select month,scope_plan,industry,sum(new_mrr+expansion_mrr+reactivation_mrr-contraction_mrr-churned_mrr) as net
 from {{ ref('mart_revenue_movements') }} group by 1,2,3
)
select m.* from {{ ref('mart_mrr_by_month') }} m left join changes c using(month,scope_plan,industry)
where abs(m.mrr-m.opening_mrr-coalesce(c.net,0)) > 0.005
