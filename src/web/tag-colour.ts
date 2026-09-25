import type { CSSProperties } from 'react';
import type { Tag } from '../shared/contracts';

export function tagColour(tag: Pick<Tag, 'hue'>): CSSProperties | undefined {
  return tag.hue === undefined ? undefined : ({ '--tag-hue': tag.hue } as CSSProperties);
}
