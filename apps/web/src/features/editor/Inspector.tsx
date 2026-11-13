import { useState } from 'react';

import type { ControlDecl, DesignDoc, EditorCommand, Entity, PlacementResult } from '@ogm/contracts/browser';

import { FocusZone } from '../../lib/input';
import { EDITOR_FOCUS_ZONES } from './focus';
import type { InstanceCountChange } from './instanceCount';

type InspectorProps = {
  doc: DesignDoc;
  selectedIds: readonly string[];
  controls: readonly ControlDecl[];
  onCommand(command: EditorCommand): void;
  onDelete?(entityId: string): void;
  onDuplicate?(entityId: string): void;
  onInstanceCount?(change: InstanceCountChange): Promise<PlacementResult>;
  onSelect?(ids: string[]): void;
};

type ControlContext = {
  control: ControlDecl;
  targets: Extract<EditorCommand, { op: 'set' }>['targets'];
  value: unknown;
  scopeLabel: string;
  prefab?: string;
};

export function Inspector({
  doc,
  selectedIds,
  controls,
  onCommand,
  onDelete,
  onDuplicate,
  onInstanceCount,
  onSelect,
}: InspectorProps) {
  const selected = selectedIds.map((id) => doc.entities[id]).find((entity) => entity !== undefined);
  const visible = controls.flatMap((control) => {
    const context = controlContext(control, doc, selected);
    return context === undefined ? [] : [context];
  });

  return (
    <FocusZone
      id={EDITOR_FOCUS_ZONES.inspector}
      className={`editor-inspector${selected || visible.length > 0 ? ' has-content' : ''}`}
    >
      {!selected && visible.length === 0 ? (
        <div className="inspector-empty">
          <h3>Nothing selected</h3>
          <p>Tap something in your game to change it. Drag it to move it.</p>
          <ul>
            <li>
              <b>R</b> turn
            </li>
            <li>
              <b>Del</b> remove
            </li>
            <li>
              <b>Ctrl+Z</b> undo
            </li>
          </ul>
        </div>
      ) : null}
      {selected ? <h3>{selected.prefab}</h3> : null}
      {selected && (onDelete !== undefined || onDuplicate !== undefined) ? (
        <div className="entity-actions" role="group" aria-label={`This ${selected.prefab}`}>
          <button className="tap-secondary" type="button" onClick={() => onDuplicate?.(selected.id)}>
            Copy
          </button>
          <button className="tap-secondary" type="button" onClick={() => onDelete?.(selected.id)}>
            Remove
          </button>
        </div>
      ) : null}
      {visible.map((context) => (
        <div className="control-row" key={context.control.id}>
          <div className="control-heading">
            <span>{context.control.label}</span>
            <small>{context.scopeLabel}</small>
          </div>
          <ControlWidget context={context} onCommand={onCommand} onInstanceCount={onInstanceCount} />
        </div>
      ))}
      {doc.globals['scenery.backdrop'] ? (
        <div aria-label="Scene items">
          <h3>Backdrop: {(doc.globals['scenery.backdrop'] as { assetId: string }).assetId}</h3>
          {Object.values(doc.entities)
            .filter((entity) => entity.prefab.startsWith('scenery:'))
            .map((entity) => (
              <button key={entity.id} className="tap-secondary" type="button" onClick={() => onSelect?.([entity.id])}>
                {entity.prefab.slice('scenery:'.length)}
              </button>
            ))}
        </div>
      ) : null}
    </FocusZone>
  );
}

function ControlWidget({
  context,
  onCommand,
  onInstanceCount,
}: {
  context: ControlContext;
  onCommand(command: EditorCommand): void;
  onInstanceCount?(change: InstanceCountChange): Promise<PlacementResult>;
}) {
  const { control, targets } = context;
  const [instanceError, setInstanceError] = useState<string>();
  const [changingInstances, setChangingInstances] = useState(false);
  const set = (value: unknown) => onCommand({ op: 'set', control: control.id, targets, value });
  switch (control.widget.kind) {
    case 'toggle': {
      const value = context.value === true;
      return (
        <button className="toggle-control tap-secondary" type="button" aria-pressed={value} onClick={() => set(!value)}>
          <span className="sr">{control.label}</span>
        </button>
      );
    }
    case 'slider': {
      const value = numberValue(context.value, control.default, control.widget.min);
      return (
        <input
          aria-label={control.label}
          type="range"
          min={control.widget.min}
          max={control.widget.max}
          step={control.widget.step}
          value={value}
          onChange={(event) => set(event.currentTarget.valueAsNumber)}
        />
      );
    }
    case 'count': {
      const instances =
        control.widget.semantics === 'instances' && targets !== 'global' && context.prefab !== undefined;
      const value = instances ? targets.length : numberValue(context.value, control.default, control.widget.min);
      const change = (direction: -1 | 1) => {
        if (!instances) {
          set(value + direction);
          return;
        }
        if (onInstanceCount === undefined || context.prefab === undefined) {
          setInstanceError('Instance editing is unavailable.');
          return;
        }
        setChangingInstances(true);
        void onInstanceCount({ direction, prefab: context.prefab, targetIds: targets })
          .then((result) => setInstanceError(result.ok ? undefined : result.reason))
          .finally(() => setChangingInstances(false));
      };
      return (
        <>
          <div className="count-control">
            <button
              className="tap-secondary"
              type="button"
              aria-label={`Decrease ${control.label}`}
              disabled={changingInstances || value <= control.widget.min}
              onClick={() => change(-1)}
            >
              −
            </button>
            <output>{value}</output>
            <button
              className="tap-secondary"
              type="button"
              aria-label={`Increase ${control.label}`}
              disabled={changingInstances || value >= control.widget.max}
              onClick={() => change(1)}
            >
              +
            </button>
          </div>
          {instanceError ? <small role="alert">{instanceError}</small> : null}
        </>
      );
    }
    case 'choice':
      if (control.widget.options.length <= 4) {
        return (
          <div className="choice-segment" role="group" aria-label={control.label}>
            {control.widget.options.map((option) => (
              <button
                className="tap-secondary"
                type="button"
                key={option.value}
                aria-pressed={option.value === context.value}
                onClick={() => set(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        );
      }
      return (
        <select
          aria-label={control.label}
          value={String(context.value ?? control.default)}
          onChange={(event) => set(event.currentTarget.value)}
        >
          {control.widget.options.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case 'color':
      return (
        <input
          aria-label={control.label}
          type="color"
          value={typeof context.value === 'string' ? context.value : String(control.default)}
          onChange={(event) => set(event.currentTarget.value)}
        />
      );
    case 'text':
      return (
        <input
          aria-label={control.label}
          type="text"
          maxLength={control.widget.maxLength}
          value={typeof context.value === 'string' ? context.value : String(control.default)}
          onChange={(event) => set(event.currentTarget.value)}
        />
      );
    default:
      return null;
  }
}

function controlContext(
  control: ControlDecl,
  doc: DesignDoc,
  selected: Entity | undefined,
): ControlContext | undefined {
  if (control.scope === 'global') {
    return {
      control,
      targets: 'global',
      value: doc.globals[control.id] ?? control.default,
      scopeLabel: 'Game',
    };
  }
  if (selected === undefined) return undefined;
  if (['scenery.depth', 'scenery.parallax'].includes(control.id) && !selected.prefab.startsWith('scenery:'))
    return undefined;
  if (control.scope === 'instance') {
    const pose = selected.props.pose as { position?: unknown[] } | undefined;
    return {
      control,
      targets: [selected.id],
      value:
        selected.props[control.id] ??
        (control.id === 'scenery.depth' ? pose?.position?.[2] : undefined) ??
        control.default,
      scopeLabel: `This ${selected.prefab}`,
      prefab: selected.prefab,
    };
  }
  if (control.scope === 'prefab') {
    const targets = Object.values(doc.entities)
      .filter((entity) => entity.prefab === selected.prefab)
      .map((entity) => entity.id);
    return {
      control,
      targets,
      value: selected.props[control.id] ?? control.default,
      scopeLabel: `All ${selected.prefab}s`,
      prefab: selected.prefab,
    };
  }
  const targets = matchingTargets(doc, control.scope.selector);
  return {
    control,
    targets,
    value: selected.props[control.id] ?? control.default,
    scopeLabel: 'Matching',
    prefab: selected.prefab,
  };
}

function matchingTargets(
  doc: DesignDoc,
  selector: { tag?: string; prefab?: string; ids?: string[]; where?: Record<string, unknown> },
): string[] {
  return Object.values(doc.entities)
    .filter((entity) => selector.prefab === undefined || entity.prefab === selector.prefab)
    .filter((entity) => selector.ids === undefined || selector.ids.includes(entity.id))
    .filter((entity) => selector.tag === undefined || hasTag(entity, selector.tag))
    .filter((entity) =>
      Object.entries(selector.where ?? {}).every(([key, value]) => Object.is(entity.props[key], value)),
    )
    .map((entity) => entity.id);
}

function hasTag(entity: Entity, tag: string): boolean {
  if (entity.props.tag === tag) return true;
  return Array.isArray(entity.props.tags) && entity.props.tags.includes(tag);
}

function numberValue(value: unknown, fallback: unknown, minimum: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof fallback === 'number' && Number.isFinite(fallback)) return fallback;
  return minimum;
}
