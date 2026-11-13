# Common read-only queries

Use these against the rendition database unless noted. `pdf_rendition_task.status`: 0 PENDING, 1 PROCESSING, 2 SUCCESS, 3 FAILED.

ECS in-flight: `status = 1 AND resource_tier IS NOT NULL`.

Column names: `error_msg`, `relate_id`, `relate_version_id`. There is no `error_message` or `document_version_id`.

[`scripts/query.mjs`](../scripts/query.mjs) prints epoch-millisecond columns as `millis (yyyy-MM-dd HH:mm:ss.SSS +08:00)`. Do not convert them again.

## Latest task

```sql
SELECT id, status, resource_tier, source_file_size, priority, relate_id, relate_version_id, rendition_id, create_time, start_at, end_at, execution_deadline, duration, error_code, error_msg, ecs_task_arn
FROM pdf_rendition_task
ORDER BY id DESC
LIMIT 1;
```

## Recent tasks

```sql
SELECT id, status, resource_tier, source_file_size, create_time, start_at, end_at, duration, error_code, error_msg, ecs_task_arn
FROM pdf_rendition_task
ORDER BY id DESC
LIMIT 10;
```

## Current ECS in-flight

```sql
SELECT id, status, resource_tier, source_file_size, start_at, execution_deadline, ecs_task_arn
FROM pdf_rendition_task
WHERE status = 1
  AND resource_tier IS NOT NULL
ORDER BY id DESC;
```

## In-flight count by tier

```sql
SELECT resource_tier, COUNT(*) AS task_count
FROM pdf_rendition_task
WHERE status = 1
  AND resource_tier IS NOT NULL
GROUP BY resource_tier
ORDER BY resource_tier;
```

For AWS-side concurrency after UI triggers (not this query path): cluster `onerim-content-docs-dev-cluster`, worker family `docs-rendition-worker-dev-task-definition`, logs `/ecs/docs-rendition-worker-dev-task-definition`.
