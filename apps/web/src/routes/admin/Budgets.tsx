import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { formatUnits } from '../../features/build-chat/units';
import { adminKeys, adminRequest, invalidateAdmin, useAdminBudget, useAdminSettings } from './api';
import { ConfirmDialog } from './ConfirmDialog';
import { UserBudgetSettings } from './UserBudgetSettings';
import type { AdminBudget, AdminMember, AdminSettings } from './types';

export function parseUnits(text: string, microUsdPerUnit: number): number | null {
  const value = text.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || value.length > 64 || !Number.isSafeInteger(microUsdPerUnit) || microUsdPerUnit <= 0) return null;

  const fractional = match[2] ?? '';
  const scale = 10n ** BigInt(fractional.length);
  const units = BigInt(match[1]!) * scale + BigInt(fractional || '0');
  const scaledMicroUsd = units * BigInt(microUsdPerUnit);
  if (scaledMicroUsd % scale !== 0n) return null;

  const microUsd = scaledMicroUsd / scale;
  return microUsd <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(microUsd) : null;
}

export function formatEditableUnits(microUsd: number, microUsdPerUnit: number): string {
  return String(microUsd / microUsdPerUnit);
}

export function parseSlot(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 8 ? parsed : null;
}

type SettingsPatch = {
  resetZone: string;
  slots: { new_game: number; edit: number };
  platformCapMicroUsd?: number;
};

export function buildSettingsPatch({
  resetZone,
  cap,
  capDirty,
  microUsdPerUnit,
  newSlots,
  editSlots,
}: {
  resetZone: string;
  cap: string;
  capDirty: boolean;
  microUsdPerUnit: number;
  newSlots: string;
  editSlots: string;
}): SettingsPatch | null {
  const parsedCap = parseUnits(cap, microUsdPerUnit);
  const parsedNewSlots = parseSlot(newSlots);
  const parsedEditSlots = parseSlot(editSlots);
  if (parsedCap === null || parsedNewSlots === null || parsedEditSlots === null) return null;

  return {
    resetZone,
    slots: { new_game: parsedNewSlots, edit: parsedEditSlots },
    ...(capDirty ? { platformCapMicroUsd: parsedCap } : {}),
  };
}

export function Budgets() {
  const settings = useAdminSettings();
  const budget = useAdminBudget();
  if (settings.isPending || budget.isPending) return <p className="admin-state">Loading budgets…</p>;
  if (settings.isError || budget.isError) return <p className="admin-state">Not allowed</p>;
  return <BudgetContent budget={budget.data} settings={settings.data} />;
}

function BudgetContent({ settings, budget }: { settings: AdminSettings; budget: AdminBudget }) {
  const [resetZone, setResetZone] = useState(settings.resetZone);
  const [newSlots, setNewSlots] = useState(String(settings.slots.new_game));
  const [editSlots, setEditSlots] = useState(String(settings.slots.edit));
  const [cap, setCap] = useState(formatEditableUnits(settings.platformCapMicroUsd, settings.microUsdPerUnit));
  const [capDirty, setCapDirty] = useState(false);
  const [confirmSettings, setConfirmSettings] = useState(false);
  const settingsPatch = buildSettingsPatch({
    resetZone,
    cap,
    capDirty,
    microUsdPerUnit: settings.microUsdPerUnit,
    newSlots,
    editSlots,
  });

  useEffect(() => {
    if (!capDirty) {
      setCap(formatEditableUnits(settings.platformCapMicroUsd, settings.microUsdPerUnit));
    }
  }, [capDirty, settings.microUsdPerUnit, settings.platformCapMicroUsd]);

  const saveSettings = useMutation({
    mutationFn: () => {
      if (!settingsPatch) throw new Error('invalid_budget_settings');
      return adminRequest('/admin/settings', {
        method: 'PATCH',
        json: settingsPatch,
      });
    },
    onSuccess: async () => {
      await invalidateAdmin(adminKeys.settings(), adminKeys.budget());
      setCapDirty(false);
      setConfirmSettings(false);
    },
  });
  const saveAllowance = useMutation({
    mutationFn: ({ userId, dailyMicroUsd }: { userId: string; dailyMicroUsd: number }) =>
      adminRequest(`/admin/allowances/${encodeURIComponent(userId)}`, { method: 'PUT', json: { dailyMicroUsd } }),
    onSuccess: () => invalidateAdmin(adminKeys.members(), adminKeys.settings(), adminKeys.budget()),
  });
  const settingsValid = settingsPatch !== null;
  const zones = [settings.resetZone, 'UTC', ...Intl.supportedValuesOf('timeZone')].filter(
    (zone, index, all) => all.indexOf(zone) === index,
  );

  return (
    <section>
      <p className="admin-kicker">Family</p>
      <h2>Budgets</h2>
      <UserBudgetSettings />
      <div className="admin-card admin-settings-grid">
        <label>
          Reset zone
          <select value={resetZone} onChange={(event) => setResetZone(event.target.value)}>
            {zones.map((zone) => (
              <option key={zone}>{zone}</option>
            ))}
          </select>
        </label>
        <label>
          Creation slots
          <input max="8" min="0" type="number" value={newSlots} onChange={(event) => setNewSlots(event.target.value)} />
        </label>
        <label>
          Edit slots
          <input
            max="8"
            min="0"
            type="number"
            value={editSlots}
            onChange={(event) => setEditSlots(event.target.value)}
          />
        </label>
        <label>
          Platform cap ({settings.unitLabel})
          <input
            inputMode="decimal"
            value={cap}
            onChange={(event) => {
              setCap(event.target.value);
              setCapDirty(true);
            }}
          />
        </label>
        <p>
          In use: {budget.inUse.new_game} creation · {budget.inUse.edit} edit
        </p>
        <p>Resets {new Date(budget.resetsAt).toLocaleString()}</p>
        <button
          className="admin-primary tap-primary"
          disabled={!settingsValid || saveSettings.isPending}
          type="button"
          onClick={() => {
            saveSettings.reset();
            setConfirmSettings(true);
          }}
        >
          Save settings
        </button>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Daily allowance</th>
              <th scope="col">Remaining today</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {budget.members.map((member) => (
              <BudgetMemberRow
                key={member.userId}
                busy={saveAllowance.isPending}
                error={saveAllowance.isError}
                member={member}
                settings={settings}
                onPrepare={() => saveAllowance.reset()}
                onSave={(dailyMicroUsd) => saveAllowance.mutateAsync({ userId: member.userId, dailyMicroUsd })}
              />
            ))}
          </tbody>
        </table>
      </div>
      {confirmSettings ? (
        <ConfirmDialog
          busy={saveSettings.isPending}
          error={saveSettings.isError ? 'Change could not be saved. Try again.' : undefined}
          title="Save family budget settings?"
          onCancel={() => setConfirmSettings(false)}
          onConfirm={() => saveSettings.mutate()}
        >
          <p>
            {cap} {settings.unitLabel}
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function BudgetMemberRow({
  busy,
  error,
  member,
  settings,
  onSave,
  onPrepare,
}: {
  busy: boolean;
  error: boolean;
  member: AdminMember;
  settings: AdminSettings;
  onSave(value: number): Promise<unknown>;
  onPrepare(): void;
}) {
  const [value, setValue] = useState(formatEditableUnits(member.dailyMicroUsd, settings.microUsdPerUnit));
  const [confirm, setConfirm] = useState(false);
  const parsed = parseUnits(value, settings.microUsdPerUnit);
  return (
    <tr>
      <td data-label="Member">{member.email}</td>
      <td data-label="Daily allowance">
        <input
          aria-label={`Daily allowance for ${member.email}`}
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </td>
      <td data-label="Remaining today">
        {formatUnits(member.remainingMicroUsd, settings.unitLabel, settings.microUsdPerUnit)}
      </td>
      <td data-label="Actions">
        <button
          className="admin-secondary tap-secondary"
          disabled={parsed === null || busy}
          type="button"
          onClick={() => {
            onPrepare();
            setConfirm(true);
          }}
        >
          Save
        </button>
        {confirm && parsed !== null ? (
          <ConfirmDialog
            busy={busy}
            error={error ? 'Change could not be saved. Try again.' : undefined}
            title="Save allowance?"
            onCancel={() => setConfirm(false)}
            onConfirm={async () => {
              try {
                await onSave(parsed);
                setConfirm(false);
              } catch {
                // The dialog stays open and renders the mutation error supplied by the parent.
              }
            }}
          >
            <p>
              {member.email}: {value} {settings.unitLabel}
            </p>
          </ConfirmDialog>
        ) : null}
      </td>
    </tr>
  );
}
