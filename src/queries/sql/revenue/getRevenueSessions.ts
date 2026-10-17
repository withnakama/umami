import { EVENT_TYPE } from '@/lib/constants';
import prisma from '@/lib/prisma';
import type { PageResult, QueryFilters, WebsiteSession } from '@/lib/types';

const FUNCTION_NAME = 'getRevenueSessions';

export async function getRevenueSessions(
  ...args: [websiteId: string, currency: string, filters: QueryFilters]
): Promise<PageResult<WebsiteSession[]>> {
  return relationalQuery(...args);
}

async function relationalQuery(websiteId: string, currency: string, filters: QueryFilters) {
  const { pagedRawQuery, parseFilters } = prisma;
  const { search } = filters;
  const { filterQuery, dateQuery, cohortQuery, queryParams } = parseFilters({
    ...filters,
    websiteId,
    currency,
    search: search ? `%${search}%` : undefined,
  });

  const searchQuery = search
    ? `and (session.browser ilike {{search}}
           or session.os ilike {{search}}
           or session.device ilike {{search}}
           or session.city ilike {{search}})`
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
      sum(case when website_event.event_type = 1 then 1 else 0 end) as "views",
      sum(case when website_event.event_type = 2 then 1 else 0 end) as "events",
      max(website_event.created_at) as "createdAt"
    from website_event
    ${cohortQuery}
    join session
      on session.session_id = website_event.session_id
      and session.website_id = website_event.website_id
    join (
      select distinct session_id
      from revenue
      where website_id = {{websiteId::uuid}}
      and revenue.created_at between {{startDate}} and {{endDate}}
        and upper(currency) = {{currency}}
    ) rev on rev.session_id = website_event.session_id
    where website_event.website_id = {{websiteId::uuid}}
      and website_event.event_type != ${EVENT_TYPE.performance}
    ${dateQuery}
    ${filterQuery}
    ${searchQuery}
    group by
      session.session_id,
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
    order by max(website_event.created_at) desc
    `,
    queryParams,
    filters,
    FUNCTION_NAME,
  );
}
