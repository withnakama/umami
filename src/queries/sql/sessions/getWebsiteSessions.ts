import { EVENT_TYPE, FILTER_COLUMNS } from '@/lib/constants';
import prisma from '@/lib/prisma';
import type { PageResult, QueryFilters, WebsiteSession } from '@/lib/types';

const FUNCTION_NAME = 'getWebsiteSessions';
const _QUALIFIED_FILTER_COLUMNS = Object.fromEntries(
  Object.entries(FILTER_COLUMNS).map(([key, value]) => [key, `website_event.${value}`]),
);

export async function getWebsiteSessions(
  ...args: [websiteId: string, filters: QueryFilters]
): Promise<PageResult<WebsiteSession[]>> {
  return relationalQuery(...args);
}

async function relationalQuery(websiteId: string, filters: QueryFilters) {
  const { pagedRawQuery, parseFilters } = prisma;
  const { search } = filters;
  const { filterQuery, dateQuery, cohortQuery, queryParams } = parseFilters({
    ...filters,
    websiteId,
    search: search ? `%${search}%` : undefined,
  });

  const searchQuery = search
    ? `and (distinct_id ilike {{search}}
           or city ilike {{search}}
           or browser ilike {{search}}
           or os ilike {{search}}
           or device ilike {{search}})`
    : '';

  return pagedRawQuery(
    `
    select
      session.session_id as "id",
      session.website_id as "websiteId",
      website_event.hostname,
      session.browser,
      session.os,
      session.device,
      session.screen,
      session.language,
      session.country,
      session.region,
      session.city,
      min(website_event.created_at) as "firstAt",
      max(website_event.created_at) as "lastAt",
      count(distinct website_event.visit_id) as "visits",
      sum(case when website_event.event_type = ${EVENT_TYPE.pageView} then 1 else 0 end) as "views",
      sum(case when website_event.event_type = ${EVENT_TYPE.customEvent} then 1 else 0 end) as "events",
      max(website_event.created_at) as "createdAt"
    from website_event 
    ${cohortQuery}
    join session on session.session_id = website_event.session_id
      and session.website_id = website_event.website_id
    where website_event.website_id = {{websiteId::uuid}}
      and website_event.event_type != ${EVENT_TYPE.performance}
    ${dateQuery}
    ${filterQuery}
    ${searchQuery}
    group by session.session_id, 
      session.website_id, 
      website_event.hostname, 
      session.browser, 
      session.os, 
      session.device, 
      session.screen, 
      session.language, 
      session.country, 
      session.region, 
      session.city
    `,
    queryParams,
    filters,
    FUNCTION_NAME,
    'max(website_event.created_at) desc, session.session_id',
  );
}
