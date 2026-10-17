import { addHours } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { EVENT_TYPE } from '@/lib/constants';
import prisma from '@/lib/prisma';

const FUNCTION_NAME = 'getWebsiteListCharts';
const DEFAULT_TIMEZONE = 'UTC';
const BUCKET_HOURS = 12;

interface WebsiteListChartPoint {
  websiteId: string;
  x: string | null;
  y: number;
}

export interface WebsiteListChartData {
  values: number[];
  total: number;
}

export async function getWebsiteListCharts(
  websiteIds: string[],
  {
    startDate,
    endDate,
    timezone = DEFAULT_TIMEZONE,
    eventType,
  }: {
    startDate: Date;
    endDate: Date;
    timezone?: string;
    eventType?: number;
  },
): Promise<Record<string, WebsiteListChartData>> {
  if (!websiteIds.length) {
    return {};
  }

  const points = await relationalQuery(websiteIds, startDate, endDate, timezone, eventType);
  return formatResults({ points, websiteIds, startDate, endDate, timezone });
}

async function relationalQuery(
  websiteIds: string[],
  startDate: Date,
  endDate: Date,
  timezone: string,
  eventType?: number,
): Promise<WebsiteListChartPoint[]> {
  const { rawQuery } = prisma;
  const eventTypeQuery =
    eventType != null
      ? `and website_event.event_type = ${eventType}`
      : `and website_event.event_type NOT IN (${EVENT_TYPE.customEvent}, ${EVENT_TYPE.performance})`;
  const localTime = 'timezone_datetime(website_event.created_at, {{timezone}})';
  const bucketSql = `strftime('%Y-%m-%d ', ${localTime}) || printf('%02d:00:00',
    (cast(strftime('%H', ${localTime}) as integer) / ${BUCKET_HOURS}) * ${BUCKET_HOURS})`;

  return rawQuery(
    `
    with events as (
      select
        website_event.website_id as "websiteId",
        ${bucketSql} as x,
        website_event.session_id
      from website_event
      where website_event.website_id = any({{websiteIds}}::uuid[])
        ${eventTypeQuery}
        and website_event.created_at between {{startDate}} and {{endDate}}
    )
    select "websiteId", x, count(distinct session_id) as y
    from events
    group by "websiteId", x
    union all
    select "websiteId", null as x, count(distinct session_id) as y
    from events
    group by "websiteId"
    order by 1, 2
    `,
    { websiteIds, startDate, endDate, timezone },
    FUNCTION_NAME,
  );
}

function formatResults({
  points,
  websiteIds,
  startDate,
  endDate,
  timezone,
}: {
  points: WebsiteListChartPoint[];
  websiteIds: string[];
  startDate: Date;
  endDate: Date;
  timezone: string;
}) {
  const buckets: string[] = [];

  for (
    let current = new Date(startDate);
    current <= endDate;
    current = addHours(current, BUCKET_HOURS)
  ) {
    buckets.push(formatInTimeZone(current, timezone, 'yyyy-MM-dd HH:00:00'));
  }

  const bucketIndex = new Map(buckets.map((bucket, index) => [bucket, index]));
  const charts = websiteIds.reduce<Record<string, WebsiteListChartData>>((result, websiteId) => {
    result[websiteId] = {
      values: Array.from({ length: buckets.length }, () => 0),
      total: 0,
    };
    return result;
  }, {});

  points.forEach(({ websiteId, x, y }) => {
    if (!charts[websiteId]) {
      return;
    }

    // Subtotal rows have no time bucket.
    // carry the window-wide distinct total per website
    if (!x) {
      charts[websiteId].total = Number(y);
      return;
    }

    const index = bucketIndex.get(String(x).slice(0, 19));

    if (index !== undefined) {
      charts[websiteId].values[index] = Number(y);
    }
  });

  return charts;
}
