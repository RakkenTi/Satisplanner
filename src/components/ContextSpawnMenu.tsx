import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GitFork, Merge, PackagePlus, Trash2 } from 'lucide-react';
import {
  formatRate,
  fuzzyScore,
  ITEMS,
  MACHINES,
  RECIPES_BY_INPUT,
  RECIPES_BY_OUTPUT,
} from '../data/catalog';
import type { GameRecipe, NodeKind } from '../engine/types';
import { SpriteIcon } from './SpriteIcon';

export interface PendingSpawnState {
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  fromNodeId: string;
  fromDirection: 'input' | 'output'; // direction of the port the user dragged FROM
  itemId: string;
}

interface ContextSpawnMenuProps {
  pending: PendingSpawnState | null;
  onClose: () => void;
  onSpawnRecipe: (recipeId: string) => void;
  onSpawnLogistics: (kind: Exclude<NodeKind, 'recipe'>) => void;
}

export const ContextSpawnMenu: React.FC<ContextSpawnMenuProps> = ({
  pending,
  onClose,
  onSpawnRecipe,
  onSpawnLogistics,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (pending) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pending, onClose]);

  const recipes = useMemo<GameRecipe[]>(() => {
    if (!pending) return [];
    // If dragged FROM an input port, we need recipes that PRODUCE itemId.
    // If dragged FROM an output port, we need recipes that CONSUME itemId.
    const list =
      pending.fromDirection === 'input'
        ? RECIPES_BY_OUTPUT[pending.itemId] ?? []
        : RECIPES_BY_INPUT[pending.itemId] ?? [];

    if (!query.trim()) return list;
    return list
      .map((r) => ({ r, score: fuzzyScore(query, r.name, r.id) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.r);
  }, [pending, query]);

  if (!pending) return null;

  const item = ITEMS[pending.itemId];
  const needProducer = pending.fromDirection === 'input';

  // Clamp floating position inside viewport
  const left = Math.min(window.innerWidth - 336, Math.max(12, pending.screenX + 8));
  const top = Math.min(window.innerHeight - 376, Math.max(58, pending.screenY - 24));

  return (
    <div
      ref={menuRef}
      id="context-spawn-menu"
      className="spawn-menu"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="spawn-menu-header">
        <SpriteIcon iconId={item?.icon ?? pending.itemId} size={20} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {needProducer ? 'Produce' : 'Consume'} {item?.name ?? pending.itemId}
        </span>
      </div>

      <input
        ref={inputRef}
        className="spawn-menu-search"
        placeholder="Filter recipes..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && recipes.length > 0) {
            onSpawnRecipe(recipes[0].id);
          }
        }}
      />

      <div className="spawn-menu-list">
        {/* Quick Logistics Options right at top */}
        <div style={{ display: 'flex', gap: 4, padding: '2px 4px 6px', borderBottom: '1px solid var(--border-subtle)', marginBottom: 4 }}>
          {needProducer ? (
            <>
              <button
                type="button"
                className="btn btn-sm"
                style={{ flex: 1 }}
                onClick={() => onSpawnLogistics('input')}
              >
                <PackagePlus size={12} /> Import
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{ flex: 1 }}
                onClick={() => onSpawnLogistics('merger')}
              >
                <Merge size={12} /> Merger
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{ flex: 1 }}
                onClick={() => onSpawnLogistics('splitter')}
              >
                <GitFork size={12} /> Splitter
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-sm"
                style={{ flex: 1 }}
                onClick={() => onSpawnLogistics('splitter')}
              >
                <GitFork size={12} /> Splitter
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{ flex: 1 }}
                onClick={() => onSpawnLogistics('merger')}
              >
                <Merge size={12} /> Merger
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{ flex: 1 }}
                onClick={() => onSpawnLogistics('sink')}
              >
                <Trash2 size={12} /> Sink
              </button>
            </>
          )}
        </div>

        {recipes.length === 0 ? (
          <div style={{ padding: 14, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11.5 }}>
            No matching recipes.
          </div>
        ) : (
          recipes.map((r) => {
            const machine = MACHINES[r.producers[0]];
            const cycles = 60 / r.time;
            const rate = needProducer
              ? (r.out[pending.itemId] ?? 0) * cycles
              : (r.in[pending.itemId] ?? 0) * cycles;
            return (
              <button
                key={r.id}
                type="button"
                className="palette-row"
                style={{ padding: '6px 8px' }}
                onClick={() => onSpawnRecipe(r.id)}
              >
                <div className="palette-row-left" style={{ gap: 8 }}>
                  <SpriteIcon iconId={r.icon} size={22} />
                  <div style={{ minWidth: 0 }}>
                    <div className="palette-row-title" style={{ fontSize: 12 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.name}
                      </span>
                      {r.isAlternate && <span className="alt-tag">ALT</span>}
                    </div>
                    <div className="palette-row-sub">
                      {machine?.name ?? r.producers[0]} · {formatRate(rate)}/m per machine
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
