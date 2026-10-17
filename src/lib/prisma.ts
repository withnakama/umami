import debug from 'debug';
import { PrismaClient } from '@/generated/prisma/client';
import {
  DATA_TYPE,
  DEFAULT_PAGE_SIZE,
  FILTER_COLUMNS,
  OPERATORS,
  SESSION_COLUMNS,
} from './constants';
import { filtersObjectToArray } from './params';
import { SqliteAdapter } from './sqlite';
import type { Operator, PropertyFilter, QueryFilters, QueryOptions } from './types';

// Raw SQLite count queries can return bigint values.
(BigInt.prototype as unknown as { toJSON(): number }).toJSON = function () {
  return Number(this);
};

const log = debug('umami:prisma');

const EQUALITY_OPERATORS: Operator[] = [OPERATORS.equals, OPERATORS.notEquals];
const SEARCH_OPERATORS: Operator[] = [OPERATORS.contains, OPERATORS.doesNotContain];
const REGEX_OPERATORS: Operator[] = [OPERATORS.regex, OPERATORS.notRegex];

const PRISMA = 'prisma';

const PRISMA_LOG_OPTIONS = {
  log: [
    {
      emit: 'event' as const,
      level: 'query' as const,
    },
  ],
};

const DATE_FORMATS = {
  minute: '%Y-%m-%dT%H:%M:00Z',
  hour: '%Y-%m-%dT%H:00:00Z',
  day: '%Y-%m-%dT00:00:00Z',
  month: '%Y-%m-01T00:00:00Z',
  year: '%Y-01-01T00:00:00Z',
};

const DATE_STRING_FORMATS = {
  utc: '%Y-%m-%dT%H:%M:%SZ',
  second: '%Y-%m-%dT%H:%M:%SZ',
};

function isUtcTimezone(timezone?: string) {
  return timezone?.toLowerCase() === 'utc';
}

function getZonedDateField(field: string, timezone?: string) {
  if (!timezone || isUtcTimezone(timezone)) return field;
  new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  return `timezone_datetime(${field}, '${timezone}')`;
}

function getAddIntervalQuery(field: string, interval: string): string {
  return `strftime('%Y-%m-%dT%H:%M:%f+00:00', ${field}, '+${interval}')`;
}

function getDayDiffQuery(field1: string, field2: string): string {
  return `cast(julianday(${field1}) - julianday(${field2}) as integer)`;
}

function getCastColumnQuery(field: string, type: string): string {
  return `cast(${field} as ${type})`;
}

function getDateSQL(field: string, unit: string, timezone?: string): string {
  return `strftime('${DATE_FORMATS[unit]}', ${getZonedDateField(field, timezone)})`;
}

function getDateStringSQL(
  field: string,
  unit: keyof typeof DATE_STRING_FORMATS = 'utc',
  timezone?: string,
): string {
  return `strftime('${DATE_STRING_FORMATS[unit]}', ${getZonedDateField(field, timezone)})`;
}

function getDateWeeklySQL(field: string, timezone?: string) {
  return `strftime('%w:%H', ${getZonedDateField(field, timezone)})`;
}

export function getTimestampSQL(field: string) {
  return `unixepoch(${field})`;
}

function getTimestampDiffSQL(field1: string, field2: string): string {
  return `(unixepoch(${field2}) - unixepoch(${field1}))`;
}

function getSearchSQL(column: string, param: string = 'search'): string {
  return `and ${column} like {{${param}}}`;
}

function mapFilter(
  column: string,
  operator: string,
  name: string,
  type: string = '',
  paramName?: string,
) {
  const param = paramName ?? name;
  const value = `{{${param}${type ? `::${type}` : ''}}}`;

  if (name.startsWith('cohort_')) {
    name = name.slice('cohort_'.length);
  }

  const table = SESSION_COLUMNS.includes(name) ? 'session' : 'website_event';

  switch (operator) {
    case OPERATORS.equals:
      return `${table}.${column} = ANY(${value})`;
    case OPERATORS.notEquals:
      return `${table}.${column} != ALL(${value})`;
    case OPERATORS.contains:
      return `${table}.${column} ilike ${value}`;
    case OPERATORS.doesNotContain:
      return `${table}.${column} not ilike ${value}`;
    case OPERATORS.regex:
      return `${table}.${column} ~* ${value}`;
    case OPERATORS.notRegex:
      return `${table}.${column} !~* ${value}`;
    default:
      return '';
  }
}

function getFilterQuery(filters: Record<string, any>, options: QueryOptions = {}): string {
  const { isCohort, cohortMatch, cohortActionName } = options;
  const isOr = isCohort ? cohortMatch === 'any' : filters.match === 'any';
  const orClauses: string[] = [];
  const andClauses: string[] = [];

  filtersObjectToArray(filters, options).forEach(
    ({ name, column, operator, prefix = '', paramName }) => {
      if (isCohort) {
        column = FILTER_COLUMNS[name.slice('cohort_'.length)];
      }

      if (column) {
        const clause = mapFilter(`${prefix}${column}`, operator, name, '', paramName);
        const isAlwaysAnd = name === 'eventType' || (isCohort && name === cohortActionName);

        if (isAlwaysAnd) {
          andClauses.push(`and ${clause}`);
        } else if (isOr) {
          orClauses.push(clause);
        } else {
          andClauses.push(`and ${clause}`);
        }

        if (name === 'referrer') {
          andClauses.push(
            `and (website_event.referrer_domain != regexp_replace(website_event.hostname, '^www.', '') or website_event.referrer_domain is null)`,
          );
        }
      }
    },
  );

  const parts: string[] = [];

  if (orClauses.length > 0) {
    parts.push(`and (\n  ${orClauses.join('\n  or ')}\n)`);
  }

  parts.push(...andClauses);

  return parts.join('\n');
}

function getCohortQuery(filters: QueryFilters = {}) {
  if (!filters || Object.keys(filters).length === 0) {
    return '';
  }

  const cohortMatch = (filters as any).cohort_match;
  const cohortActionName = (filters as any).cohort_actionName;

  const filterQuery = getFilterQuery(filters, { isCohort: true, cohortMatch, cohortActionName });

  return `join
    (select distinct website_event.session_id
    from website_event
    join session on session.session_id = website_event.session_id
      and session.website_id = website_event.website_id
    where website_event.website_id = {{websiteId}}
      and website_event.created_at between {{cohort_startDate}} and {{cohort_endDate}}
      ${filterQuery}
    ) cohort
    on cohort.session_id = website_event.session_id
    `;
}

function getExcludeBounceQuery(filters: Record<string, any>) {
  if (filters.excludeBounce !== true) {
    return '';
  }

  return `join
    (select session_id, visit_id
    from website_event
    where website_id = {{websiteId}}
      and created_at between {{startDate}} and {{endDate}}
      and event_type != 5
    group by session_id, visit_id
    having sum(case when event_type NOT IN (2, 5) then 1 else 0 end) > 1
      or (
        sum(case when event_type NOT IN (2, 5) then 1 else 0 end) = 1
        and sum(case when event_type = 2 then 1 else 0 end) > 0
      )
    ) excludeBounce
    on excludeBounce.session_id = website_event.session_id
      and excludeBounce.visit_id = website_event.visit_id
    `;
}

function getDateQuery(filters: Record<string, any>) {
  const { startDate, endDate } = filters;

  if (startDate) {
    if (endDate) {
      return `and website_event.created_at between {{startDate}} and {{endDate}}`;
    } else {
      return `and website_event.created_at >= {{startDate}}`;
    }
  }

  return '';
}

function getQueryParams(filters: Record<string, any>) {
  return {
    ...filters,
    ...filtersObjectToArray(filters).reduce((obj, { name, column, operator, value, paramName }) => {
      const resolvedColumn =
        column || (name?.startsWith('cohort_') && FILTER_COLUMNS[name.slice('cohort_'.length)]);

      if (!resolvedColumn) return obj;

      const key = paramName ?? name;

      if (SEARCH_OPERATORS.includes(operator)) {
        obj[key] = `%${value}%`;
      } else if (EQUALITY_OPERATORS.includes(operator)) {
        obj[key] = Array.isArray(value) ? value : [value];
      } else {
        obj[key] = value;
      }

      return obj;
    }, {}),
  };
}

function parseFilters(filters: Record<string, any>, options?: QueryOptions) {
  const joinSession = Object.keys(filters).find(key => {
    const baseName = key.replace(/\d+$/, '');
    return ['referrer', ...SESSION_COLUMNS].includes(baseName);
  });

  const cohortFilters = Object.fromEntries(
    Object.entries(filters).filter(([key]) => key.startsWith('cohort_')),
  );
  const { sql: eventPropertyFilterQuery, params: eventPropertyFilterParams } =
    getEventPropertyFilterQuery((filters as QueryFilters).eventPropertyFilters, filters.timezone);
  const { sql: sessionPropertyFilterQuery, params: sessionPropertyFilterParams } =
    getSessionPropertyFilterQuery(
      (filters as QueryFilters).sessionPropertyFilters,
      filters.timezone,
    );

  return {
    joinSessionQuery:
      options?.joinSession || joinSession
        ? `inner join session on website_event.session_id = session.session_id and website_event.website_id = session.website_id`
        : '',
    dateQuery: getDateQuery(filters),
    filterQuery: [
      getFilterQuery(filters, options),
      eventPropertyFilterQuery,
      sessionPropertyFilterQuery,
    ]
      .filter(Boolean)
      .join('\n'),
    queryParams: {
      ...getQueryParams(filters),
      ...eventPropertyFilterParams,
      ...sessionPropertyFilterParams,
    },
    cohortQuery: getCohortQuery(cohortFilters),
    excludeBounceQuery: getExcludeBounceQuery(filters),
  };
}

function getPropertyFilterQuery(
  filters: PropertyFilter[] = [],
  propertyType: 'event' | 'session' = 'event',
  timezone?: string,
): {
  sql: string;
  params: Record<string, any>;
} {
  if (!filters.length) return { sql: '', params: {} };

  const parts: string[] = [];
  const params: Record<string, any> = {};
  const table = propertyType === 'event' ? 'event_data' : 'session_data';
  const column = propertyType === 'event' ? 'website_event_id' : 'session_id';
  const outerColumn =
    propertyType === 'event' ? 'website_event.event_id' : 'website_event.session_id';
  const dateFilter =
    propertyType === 'event' ? `and created_at between {{startDate}} and {{endDate}}` : '';

  filters.forEach(({ propertyName, dataType, operator, value }, i) => {
    const keyParam = `pf_key_${i}`;
    const valParam = `pf_val_${i}`;
    params[keyParam] = propertyName;

    let condition: string;
    switch (dataType) {
      case DATA_TYPE.number: {
        const col = 'cast(number_value as decimal)';
        params[valParam] = parseFloat(value) || 0;
        const opMap: Record<string, string> = {
          [OPERATORS.equals]: `${col} = {{${valParam}}}`,
          [OPERATORS.notEquals]: `${col} != {{${valParam}}}`,
          [OPERATORS.greaterThan]: `${col} > {{${valParam}}}`,
          [OPERATORS.lessThan]: `${col} < {{${valParam}}}`,
          [OPERATORS.greaterThanEquals]: `${col} >= {{${valParam}}}`,
          [OPERATORS.lessThanEquals]: `${col} <= {{${valParam}}}`,
        };
        condition = opMap[operator] ?? `${col} = {{${valParam}}}`;
        break;
      }
      case DATA_TYPE.date: {
        if (!value) return;
        params[valParam] = value;
        const dateCol = `date(${getZonedDateField('date_value', timezone)})`;
        const opMap: Record<string, string> = {
          [OPERATORS.before]: `${dateCol} < {{${valParam}::date}}`,
          [OPERATORS.after]: `${dateCol} > {{${valParam}::date}}`,
        };
        condition = opMap[operator] ?? `${dateCol} = {{${valParam}::date}}`;
        break;
      }
      case DATA_TYPE.array: {
        if (!value) return;
        params[valParam] = value;
        condition =
          operator === OPERATORS.contains
            ? `exists (
                select 1
                from json_each(coalesce(string_value, '[]')) as array_item
                where array_item.value = {{${valParam}}}
              )`
            : `not exists (
                select 1
                from json_each(coalesce(string_value, '[]')) as array_item
                where array_item.value = {{${valParam}}}
              )`;
        break;
      }
      default: {
        const col = 'string_value';

        if (EQUALITY_OPERATORS.includes(operator)) {
          const vals = value.split(',').filter(Boolean);
          if (!vals.length) return;
          params[valParam] = vals;
          condition =
            operator === OPERATORS.equals
              ? `${col} = ANY({{${valParam}}})`
              : `${col} != ALL({{${valParam}}})`;
        } else if (REGEX_OPERATORS.includes(operator)) {
          if (!value) return;
          params[valParam] = value;
          condition =
            operator === OPERATORS.regex
              ? `${col} ~* {{${valParam}}}`
              : `${col} !~* {{${valParam}}}`;
        } else {
          if (!value) return;
          params[valParam] = `%${value}%`;
          condition =
            operator === OPERATORS.contains
              ? `${col} ilike {{${valParam}}}`
              : `${col} not ilike {{${valParam}}}`;
        }
        break;
      }
    }

    if (propertyType === 'session') {
      parts.push(`and exists (
      select 1
      from ${table}
      where website_id = website_event.website_id
        and session_id = website_event.session_id
        and data_key = {{${keyParam}}}
        and data_type = ${dataType}
        and ${condition}
    )`);
    } else {
      parts.push(`and ${outerColumn} in (
      select ${column}
      from ${table}
      where website_id = {{websiteId::uuid}}
        ${dateFilter}
        and data_key = {{${keyParam}}}
        and data_type = ${dataType}
        and ${condition}
    )`);
    }
  });

  return { sql: parts.join('\n'), params };
}

function getEventPropertyFilterQuery(
  filters: PropertyFilter[] = [],
  timezone?: string,
): {
  sql: string;
  params: Record<string, any>;
} {
  if (!filters.length) {
    return { sql: '', params: {} };
  }

  const clauses: string[] = [];
  const keyRefs: string[] = [];
  const params: Record<string, any> = {};

  filters.forEach(({ propertyName, dataType, operator, value }, index) => {
    const keyParam = `epf_key_${index}`;
    const valParam = `epf_val_${index}`;
    params[keyParam] = propertyName;
    keyRefs.push(`{{${keyParam}}}`);

    let condition: string;

    switch (dataType) {
      case DATA_TYPE.number: {
        const col = 'cast(number_value as decimal)';
        params[valParam] = parseFloat(value) || 0;
        const opMap: Record<string, string> = {
          [OPERATORS.equals]: `${col} = {{${valParam}}}`,
          [OPERATORS.notEquals]: `${col} != {{${valParam}}}`,
          [OPERATORS.greaterThan]: `${col} > {{${valParam}}}`,
          [OPERATORS.lessThan]: `${col} < {{${valParam}}}`,
          [OPERATORS.greaterThanEquals]: `${col} >= {{${valParam}}}`,
          [OPERATORS.lessThanEquals]: `${col} <= {{${valParam}}}`,
        };
        condition = opMap[operator] ?? `${col} = {{${valParam}}}`;
        break;
      }
      case DATA_TYPE.date: {
        if (!value) return;
        params[valParam] = value;
        const dateCol = `date(${getZonedDateField('date_value', timezone)})`;
        const opMap: Record<string, string> = {
          [OPERATORS.before]: `${dateCol} < {{${valParam}::date}}`,
          [OPERATORS.after]: `${dateCol} > {{${valParam}::date}}`,
        };
        condition = opMap[operator] ?? `${dateCol} = {{${valParam}::date}}`;
        break;
      }
      case DATA_TYPE.array: {
        if (!value) return;
        params[valParam] = value;
        condition =
          operator === OPERATORS.contains
            ? `exists (
                select 1
                from json_each(coalesce(string_value, '[]')) as array_item
                where array_item.value = {{${valParam}}}
              )`
            : `not exists (
                select 1
                from json_each(coalesce(string_value, '[]')) as array_item
                where array_item.value = {{${valParam}}}
              )`;
        break;
      }
      default: {
        const col = 'string_value';

        if (EQUALITY_OPERATORS.includes(operator)) {
          const vals = value.split(',').filter(Boolean);

          if (!vals.length) return;

          params[valParam] = vals;
          condition =
            operator === OPERATORS.equals
              ? `${col} = ANY({{${valParam}}})`
              : `${col} != ALL({{${valParam}}})`;
        } else if (REGEX_OPERATORS.includes(operator)) {
          if (!value) return;

          params[valParam] = value;
          condition =
            operator === OPERATORS.regex
              ? `${col} ~* {{${valParam}}}`
              : `${col} !~* {{${valParam}}}`;
        } else {
          if (!value) return;

          params[valParam] = `%${value}%`;
          condition =
            operator === OPERATORS.contains
              ? `${col} ilike {{${valParam}}}`
              : `${col} not ilike {{${valParam}}}`;
        }
        break;
      }
    }

    clauses.push(
      `bool_or(data_key = {{${keyParam}}} and data_type = ${dataType} and ${condition})`,
    );
  });

  if (!clauses.length) {
    return { sql: '', params: {} };
  }

  return {
    sql: `and website_event.event_id in (
      select website_event_id
      from event_data
      where website_id = {{websiteId::uuid}}
        and created_at between {{startDate}} and {{endDate}}
        and data_key in (${keyRefs.join(', ')})
      group by website_event_id
      having ${clauses.join('\n        and ')}
    )`,
    params,
  };
}

function getSessionPropertyFilterQuery(
  filters: PropertyFilter[] = [],
  timezone?: string,
): {
  sql: string;
  params: Record<string, any>;
} {
  if (!filters.length) {
    return { sql: '', params: {} };
  }

  const clauses: string[] = [];
  const keyRefs: string[] = [];
  const params: Record<string, any> = {};

  filters.forEach(({ propertyName, dataType, operator, value }, index) => {
    const keyParam = `spf_key_${index}`;
    const valParam = `spf_val_${index}`;
    params[keyParam] = propertyName;
    keyRefs.push(`{{${keyParam}}}`);

    let condition: string;

    switch (dataType) {
      case DATA_TYPE.number: {
        const col = 'cast(number_value as decimal)';
        params[valParam] = parseFloat(value) || 0;
        const opMap: Record<string, string> = {
          [OPERATORS.equals]: `${col} = {{${valParam}}}`,
          [OPERATORS.notEquals]: `${col} != {{${valParam}}}`,
          [OPERATORS.greaterThan]: `${col} > {{${valParam}}}`,
          [OPERATORS.lessThan]: `${col} < {{${valParam}}}`,
          [OPERATORS.greaterThanEquals]: `${col} >= {{${valParam}}}`,
          [OPERATORS.lessThanEquals]: `${col} <= {{${valParam}}}`,
        };
        condition = opMap[operator] ?? `${col} = {{${valParam}}}`;
        break;
      }
      case DATA_TYPE.date: {
        if (!value) return;
        params[valParam] = value;
        const dateCol = `date(${getZonedDateField('date_value', timezone)})`;
        const opMap: Record<string, string> = {
          [OPERATORS.before]: `${dateCol} < {{${valParam}::date}}`,
          [OPERATORS.after]: `${dateCol} > {{${valParam}::date}}`,
        };
        condition = opMap[operator] ?? `${dateCol} = {{${valParam}::date}}`;
        break;
      }
      case DATA_TYPE.array: {
        if (!value) return;
        params[valParam] = value;
        condition =
          operator === OPERATORS.contains
            ? `exists (
                select 1
                from json_each(coalesce(string_value, '[]')) as array_item
                where array_item.value = {{${valParam}}}
              )`
            : `not exists (
                select 1
                from json_each(coalesce(string_value, '[]')) as array_item
                where array_item.value = {{${valParam}}}
              )`;
        break;
      }
      default: {
        const col = 'string_value';

        if (EQUALITY_OPERATORS.includes(operator)) {
          const vals = value.split(',').filter(Boolean);

          if (!vals.length) return;

          params[valParam] = vals;
          condition =
            operator === OPERATORS.equals
              ? `${col} = ANY({{${valParam}}})`
              : `${col} != ALL({{${valParam}}})`;
        } else if (REGEX_OPERATORS.includes(operator)) {
          if (!value) return;

          params[valParam] = value;
          condition =
            operator === OPERATORS.regex
              ? `${col} ~* {{${valParam}}}`
              : `${col} !~* {{${valParam}}}`;
        } else {
          if (!value) return;

          params[valParam] = `%${value}%`;
          condition =
            operator === OPERATORS.contains
              ? `${col} ilike {{${valParam}}}`
              : `${col} not ilike {{${valParam}}}`;
        }
        break;
      }
    }

    clauses.push(
      `bool_or(data_key = {{${keyParam}}} and data_type = ${dataType} and ${condition})`,
    );
  });

  if (!clauses.length) {
    return { sql: '', params: {} };
  }

  return {
    sql: `and exists (
      select 1
      from session_data
      where website_id = website_event.website_id
        and session_id = website_event.session_id
        and data_key in (${keyRefs.join(', ')})
      group by website_id, session_id
      having ${clauses.join('\n        and ')}
    )`,
    params,
  };
}

async function executeRawQuery(
  sql: string,
  data: Record<string, any>,
  name?: string,
): Promise<any> {
  if (process.env.LOG_QUERY) {
    log('QUERY:\n', sql);
    log('PARAMETERS:\n', data);
    log('NAME:\n', name);
  }
  const params = [];
  const sqliteSql = sql
    .replace(/=\s*ANY\(\{\{(\w+)}}(?:::uuid\[\])?\)/gi, 'IN ({{$1}})')
    .replace(/!=\s*ALL\(\{\{(\w+)}}\)/gi, 'NOT IN ({{$1}})')
    .replace(/\bILIKE\b/gi, 'LIKE')
    .replace(/!~\*/g, 'NOT REGEXP')
    .replace(/~\*/g, 'REGEXP')
    .replace(/\bbool_or\(/gi, 'max(')
    .replace(
      /percentile_cont\((\d+(?:\.\d+)?)\)\s+within\s+group\s*\(order by ([\w.]+)\)/gi,
      'percentile_cont($2, $1)',
    );

  const query = sqliteSql.replaceAll(/\{\{\s*(\w+)(::\w+)?\s*}}/g, (...args) => {
    const [, name] = args;

    const value = data[name];

    if (Array.isArray(value)) {
      params.push(...value);
      return value.length ? value.map(() => '?').join(', ') : 'NULL';
    }

    params.push(value);
    return '?';
  });

  return client.$queryRawUnsafe(query, ...params);
}

async function rawQuery(sql: string, data: Record<string, any>, name?: string): Promise<any> {
  return executeRawQuery(sql, data, name);
}

async function writeRawQuery(sql: string, data: Record<string, any>, name?: string): Promise<any> {
  return executeRawQuery(sql, data, name);
}

async function pagedQuery<T>(model: string, criteria: T, filters?: QueryFilters) {
  const { page = 1, pageSize, orderBy, sortDescending = false, search } = filters || {};
  const size = +pageSize || DEFAULT_PAGE_SIZE;

  const data = await client[model].findMany({
    ...criteria,
    ...{
      ...(size > 0 && { take: +size, skip: +size * (+page - 1) }),
      ...(orderBy && {
        orderBy: [
          {
            [orderBy]: sortDescending ? 'desc' : 'asc',
          },
        ],
      }),
    },
  });

  const count = await client[model].count({ where: (criteria as any).where });

  return { data, count, page: +page, pageSize: size, orderBy, search };
}

async function pagedRawQuery(
  query: string,
  queryParams: Record<string, any>,
  filters: QueryFilters,
  name?: string,
  defaultOrderBy?: string,
) {
  const { page = 1, pageSize, orderBy, sortDescending = false } = filters;
  const size = +pageSize || DEFAULT_PAGE_SIZE;
  const offset = +size * (+page - 1);
  const direction = sortDescending ? 'desc' : 'asc';

  const statements = [
    orderBy ? `order by ${orderBy} ${direction}` : defaultOrderBy && `order by ${defaultOrderBy}`,
    +size > 0 && `limit ${+size} offset ${offset}`,
  ]
    .filter(n => n)
    .join('\n');

  const { maxResults } = filters;
  const countQuery = maxResults
    ? `select count(*) as num from (select 1 from (${query}) t limit ${+maxResults}) t2`
    : `select count(*) as num from (${query}) t`;

  const count = await rawQuery(countQuery, queryParams).then(res => Number(res[0].num));
  const data = await rawQuery(`${query}${statements}`, queryParams, name);

  return {
    data,
    count,
    page: +page,
    pageSize: size,
    orderBy,
    isCapped: !!maxResults && +count >= +maxResults,
  };
}

function getSearchParameters(query: string, filters: Record<string, any>[]) {
  if (!query) return;

  const parseFilter = (filter: Record<string, any>) => {
    const [[key, value]] = Object.entries(filter);

    return {
      [key]:
        typeof value === 'string'
          ? {
              [value]: query,
            }
          : parseFilter(value),
    };
  };

  const params = filters.map(filter => parseFilter(filter));

  return {
    AND: {
      OR: params,
    },
  };
}

function transaction(input: any, options?: any) {
  return client.$transaction(input, options);
}

function getClient() {
  const url = process.env.DATABASE_URL;
  const logQuery = process.env.LOG_QUERY;

  if (!url) {
    throw new Error('DATABASE_URL is not set.');
  }
  if (!url.startsWith('file:')) {
    throw new Error('DATABASE_URL must be a SQLite file: URL.');
  }

  const baseAdapter = new SqliteAdapter({ url });

  const baseClient = new PrismaClient({
    adapter: baseAdapter,
    errorFormat: 'pretty',
    ...(logQuery ? PRISMA_LOG_OPTIONS : {}),
  });

  if (logQuery) {
    baseClient.$on('query', log);
  }

  log('Prisma initialized');
  globalThis[PRISMA] ??= baseClient;
  return baseClient;
}

const client = (globalThis[PRISMA] || getClient()) as ReturnType<typeof getClient>;

export default {
  client,
  transaction,
  getAddIntervalQuery,
  getCastColumnQuery,
  getDayDiffQuery,
  getDateSQL,
  getDateStringSQL,
  getDateWeeklySQL,
  getFilterQuery,
  getPropertyFilterQuery,
  getSearchParameters,
  getTimestampDiffSQL,
  getSearchSQL,
  pagedQuery,
  pagedRawQuery,
  parseFilters,
  rawQuery,
  writeRawQuery,
};
