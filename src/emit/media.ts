import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Media } from '../model/index.js';
import { REL, type OpcPackage } from '../ooxml/opc.js';
import type { RelationshipAdder } from './text.js';

const EXTENSION: Record<Media['contentType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

/** Media parts are content-hash named and shared across slides (spec 11: determinism). */
export class MediaStore {
  private readonly parts = new Set<string>();

  constructor(private readonly pkg: OpcPackage) {}

  /** Adds the bytes once and returns the part name; rasters are `raster-<hash>` so a reader can tell captures from assets (spec 05). */
  add(media: Media, prefix = ''): string {
    const hash = createHash('sha1').update(media.data).digest('hex').slice(0, 16);
    const partName = `/ppt/media/${prefix}${hash}.${EXTENSION[media.contentType]}`;
    if (!this.parts.has(partName)) {
      this.pkg.addPart(partName, media.contentType, media.data);
      this.parts.add(partName);
    }
    return partName;
  }
}

export interface MediaEmissionContext {
  sourceSlidePart: string;
  media: MediaStore;
  addRelationship: RelationshipAdder;
}

/** Stores the media part and returns the `r:embed` id of the slide's image relationship to it. */
export function relateMedia(media: Media, ctx: MediaEmissionContext, prefix = ''): string {
  const partName = ctx.media.add(media, prefix);
  const target = path.posix.relative(path.posix.dirname(ctx.sourceSlidePart), partName);
  return ctx.addRelationship(REL.image, target);
}
