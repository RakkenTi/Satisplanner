import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  FolderOpen,
  LayoutGrid,
  Maximize2,
  PanelRight,
  Plus,
  Redo2,
  Search,
  Share2,
  Undo2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { BELTS } from '../data/catalog';
import { FACTORY_TEMPLATES, type FactoryTemplate } from '../data/presets';
import type { Outpost, PlanSettings, ThemeId } from '../engine/types';
import type { PaletteMode } from './QuickPalette';

const THEME_OPTIONS: Array<{ id: ThemeId; label: string; swatch: string; title: string }> = [
  { id: 'ficsit', label: 'Steel', swatch: '#1d1d1a', title: 'FICSIT Steel' },
  { id: 'paper', label: 'Paper', swatch: '#efece4', title: 'Drafting Paper' },
  { id: 'blueprint', label: 'CAD', swatch: '#102030', title: 'Blueprint' },
];

interface TopBarProps {
  outposts: Outpost[];
  activeOutpostId: string;
  settings: PlanSettings;
  canUndo: boolean;
  canRedo: boolean;
  inspectorOpen: boolean;
  onSelectOutpost: (id: string) => void;
  onAddOutpost: () => void;
  onRenameOutpost: (id: string, name: string) => void;
  onDeleteOutpost: (id: string) => void;
  onOpenPalette: (mode: PaletteMode) => void;
  onAutoLayout: () => void;
  onFitView: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onChangeBeltTier: (tier: number) => void;
  onChangeTheme: (theme: ThemeId) => void;
  onLoadTemplate: (template: FactoryTemplate) => void;
  onExportJSON: () => void;
  onImportJSON: (file: File) => void;
  onCopyShareLink: () => void;
  onToggleInspector: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  outposts,
  activeOutpostId,
  settings,
  canUndo,
  canRedo,
  inspectorOpen,
  onSelectOutpost,
  onAddOutpost,
  onRenameOutpost,
  onDeleteOutpost,
  onOpenPalette,
  onAutoLayout,
  onFitView,
  onUndo,
  onRedo,
  onChangeBeltTier,
  onChangeTheme,
  onLoadTemplate,
  onExportJSON,
  onImportJSON,
  onCopyShareLink,
  onToggleInspector,
}) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [activeOutpostId, outposts.length]);

  useEffect(() => {
    if (!templatesOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTemplatesOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [templatesOpen]);

  const commitRename = () => {
    if (renamingId && renameDraft.trim()) {
      onRenameOutpost(renamingId, renameDraft.trim());
    }
    setRenamingId(null);
  };

  const activeTheme = settings.theme ?? 'ficsit';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            S
          </div>
          <h1 className="brand-title">Satisplanner</h1>
          <span className="brand-ver" title="Satisfactory 1.2 Recipes">
            1.2
          </span>
        </div>

        <nav className="outpost-tabs" aria-label="Factory Outposts">
          {outposts.map((o) => {
            const isActive = o.id === activeOutpostId;
            return (
              <div
                key={o.id}
                ref={isActive ? activeTabRef : undefined}
                role="tab"
                tabIndex={0}
                aria-selected={isActive}
                className={`outpost-tab ${isActive ? 'active' : ''}`}
                onClick={() => onSelectOutpost(o.id)}
                onDoubleClick={() => {
                  setRenamingId(o.id);
                  setRenameDraft(o.name);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelectOutpost(o.id);
                }}
                title="Click to switch outpost · Double-click to rename"
              >
                <span className="outpost-dot" style={{ background: o.accent }} />
                {renamingId === o.id ? (
                  <input
                    className="outpost-rename-input"
                    value={renameDraft}
                    autoFocus
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span>{o.name}</span>
                )}
                {outposts.length > 1 && (
                  <button
                    type="button"
                    className="outpost-tab-close"
                    aria-label={`Close ${o.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteOutpost(o.id);
                    }}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </nav>
        <button
          id="btn-add-outpost"
          type="button"
          className="outpost-add-btn"
          onClick={onAddOutpost}
          title="New Outpost Tab"
          aria-label="New Outpost Tab"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="topbar-right">
        <button
          id="btn-quick-plan"
          type="button"
          className="btn btn-primary"
          onClick={() => onOpenPalette('chain')}
          title="Quick Auto-Plan or Add Node (Space)"
        >
          <Search size={13} />
          <span>Plan</span>
          <span className="kbd">Space</span>
        </button>

        <button
          id="btn-power-plan"
          type="button"
          className="btn btn-power"
          onClick={() => onOpenPalette('power')}
          title="Auto-Plan a Power Facility by Target MW/GW (P)"
        >
          <Zap size={13} />
          <span>Power</span>
          <span className="kbd">P</span>
        </button>

        <div className="toolbar-divider" />

        <div
          className="theme-switcher"
          role="group"
          aria-label="Workspace Theme"
          title="Switch workspace theme"
        >
          {THEME_OPTIONS.map((t) => (
            <button
              key={t.id}
              id={`btn-theme-${t.id}`}
              type="button"
              className={`theme-pill ${activeTheme === t.id ? 'active' : ''}`}
              onClick={() => onChangeTheme(t.id)}
              title={t.title}
              aria-label={t.title}
            >
              <span className="theme-swatch" style={{ background: t.swatch }} />
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        <div
          className="belt-selector"
          role="group"
          aria-label="Maximum Conveyor Belt Tier"
          title="Max belt tier (keys 1-6). Edges above this rate show a warning."
        >
          {BELTS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`belt-pill ${settings.maxBeltTier === b.tier ? 'active' : ''}`}
              onClick={() => onChangeBeltTier(b.tier)}
              title={`${b.fullName} (${b.ratePerMin}/min)`}
            >
              {b.name}
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        <button
          id="btn-auto-layout"
          type="button"
          className="btn btn-ghost"
          onClick={onAutoLayout}
          title="Auto-layout (A)"
        >
          <LayoutGrid size={14} />
          <span>Layout</span>
        </button>

        <button
          id="btn-fit-view"
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onFitView}
          title="Fit Factory to Screen (F)"
          aria-label="Fit Factory to Screen"
        >
          <Maximize2 size={14} />
        </button>

        <button
          id="btn-undo"
          type="button"
          className="btn btn-ghost btn-icon"
          disabled={!canUndo}
          onClick={onUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <Undo2 size={14} />
        </button>

        <button
          id="btn-redo"
          type="button"
          className="btn btn-ghost btn-icon"
          disabled={!canRedo}
          onClick={onRedo}
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
        >
          <Redo2 size={14} />
        </button>

        <div className="toolbar-divider" />

        <div className="dropdown-anchor" ref={dropdownRef}>
          <button
            id="btn-templates"
            type="button"
            className="btn"
            onClick={() => setTemplatesOpen((v) => !v)}
            title="Load factory templates"
          >
            <FolderOpen size={13} />
            <span>Templates</span>
          </button>

          {templatesOpen && (
            <div className="dropdown-menu" role="menu">
              {FACTORY_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  role="menuitem"
                  className="dropdown-item"
                  onClick={() => {
                    onLoadTemplate(tpl);
                    setTemplatesOpen(false);
                  }}
                >
                  <div>
                    <div className="dropdown-item-title">{tpl.name}</div>
                    <div className="dropdown-item-sub">{tpl.subtitle}</div>
                  </div>
                  <span className="dropdown-tier-badge">{tpl.tierLabel}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          id="btn-share"
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onCopyShareLink}
          title="Copy Shareable Blueprint Link"
          aria-label="Copy Shareable Link"
        >
          <Share2 size={14} />
        </button>

        <button
          id="btn-export"
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onExportJSON}
          title="Export Blueprint JSON"
          aria-label="Export JSON"
        >
          <Download size={14} />
        </button>

        <button
          id="btn-import"
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => fileInputRef.current?.click()}
          title="Import Blueprint JSON"
          aria-label="Import JSON"
        >
          <Upload size={14} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportJSON(file);
            e.target.value = '';
          }}
        />

        <button
          id="btn-toggle-inspector"
          type="button"
          className={`btn btn-icon ${inspectorOpen ? '' : 'btn-ghost'}`}
          onClick={onToggleInspector}
          title="Toggle Inspector & Factory Summary (I)"
          aria-label="Toggle Inspector"
        >
          <PanelRight size={14} />
        </button>
      </div>
    </header>
  );
};
