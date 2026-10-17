import { gzipSync } from 'node:zlib';
import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';

export interface SaveRecordingArgs {
  websiteId: string;
  sessionId: string;
  visitId: string;
  chunkIndex: number;
  events: any[];
  eventCount: number;
  startedAt: Date;
  endedAt: Date;
}

export async function saveRecording(args: SaveRecordingArgs) {
  return relationalQuery(args);
}

async function relationalQuery({
  websiteId,
  sessionId,
  visitId,
  chunkIndex,
  events,
  eventCount,
  startedAt,
  endedAt,
}: SaveRecordingArgs) {
  const compressed = gzipSync(Buffer.from(JSON.stringify(events), 'utf-8'));

  return prisma.client.sessionReplay.create({
    data: {
      id: uuid(),
      websiteId,
      sessionId,
      visitId,
      chunkIndex,
      events: compressed as any,
      eventCount,
      startedAt,
      endedAt,
    },
  });
}
