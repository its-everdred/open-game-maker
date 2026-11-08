import { useMutation, useQuery } from '@tanstack/react-query';

import { adminKeys, adminRequest, invalidateAdmin } from './api';

type GameplaySettings = { paidApisDuringGameplay: boolean };

export function GameplayToggle({
  allowed,
  busy,
  onChange,
}: {
  allowed: boolean;
  busy: boolean;
  onChange: (allowed: boolean) => void;
}) {
  return (
    <label className="admin-card admin-switch">
      <input checked={allowed} disabled={busy} type="checkbox" onChange={(event) => onChange(event.target.checked)} />
      Allow paid APIs during gameplay
    </label>
  );
}

// Instance-wide and off by default; only an instance admin can read or change it.
export function GameplaySetting() {
  const settings = useQuery({
    queryKey: adminKeys.gameplay(),
    queryFn: () => adminRequest<GameplaySettings>('/admin/gameplay'),
    retry: false,
  });
  const save = useMutation({
    mutationFn: (allowed: boolean) =>
      adminRequest('/admin/gameplay', { method: 'PATCH', json: { paidApisDuringGameplay: allowed } }),
    onSuccess: () => invalidateAdmin(adminKeys.gameplay()),
  });
  if (!settings.data) return null;
  return (
    <GameplayToggle
      allowed={settings.data.paidApisDuringGameplay}
      busy={save.isPending}
      onChange={(allowed) => save.mutate(allowed)}
    />
  );
}
