import React from 'react';
import { DATASET, ICONS } from '../data/catalog';

interface SpriteIconProps {
  iconId: string;
  size?: number;
  title?: string;
  className?: string;
}

const SHEET_W = DATASET.spriteSheet.width;
const SHEET_H = DATASET.spriteSheet.height;
const TILE = DATASET.spriteSheet.tileSize;

export const SpriteIcon: React.FC<SpriteIconProps> = React.memo(
  ({ iconId, size = 24, title, className }) => {
    const sprite = ICONS[iconId];
    if (!sprite) {
      return (
        <span
          title={title ?? iconId}
          className={className}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            borderRadius: 4,
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
            fontSize: Math.max(9, Math.round(size * 0.48)),
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {(iconId[0] ?? '?').toUpperCase()}
        </span>
      );
    }

    const scale = size / TILE;
    const bgW = SHEET_W * scale;
    const bgH = SHEET_H * scale;
    const posX = -(sprite.x * scale);
    const posY = -(sprite.y * scale);

    return (
      <span
        role="img"
        aria-label={title ?? iconId}
        title={title}
        className={className}
        style={{
          display: 'inline-block',
          width: size,
          height: size,
          flexShrink: 0,
          backgroundImage: `url("${import.meta.env.BASE_URL}icons.webp")`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${bgW}px ${bgH}px`,
          backgroundPosition: `${posX}px ${posY}px`,
          borderRadius: 3,
        }}
      />
    );
  },
);
