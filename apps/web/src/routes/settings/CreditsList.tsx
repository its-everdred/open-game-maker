import type { CreditPack } from '@ogm/contracts/browser';
import { AiBadge, withAiGeneratedLabel } from '../../components/AiBadge';

import './settings.css';

export function CreditsList({ packs }: { packs: readonly CreditPack[] }) {
  const groups = new Map<string, CreditPack[]>();
  for (const pack of packs) {
    const group = groups.get(pack.license) ?? [];
    group.push(pack);
    groups.set(pack.license, group);
  }

  return (
    <div className="credits-list">
      {[...groups]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([license, entries]) => (
          <section key={license}>
            <h3>{license}</h3>
            <ul>
              {entries.map((pack) => (
                <li key={pack.pack}>
                  <h4 aria-label={withAiGeneratedLabel(pack.title, pack.aiGenerated)}>
                    {pack.title}
                    {pack.aiGenerated ? <AiBadge /> : null}
                  </h4>
                  <span>{pack.attribution}</span>
                  <span>Licence source: {pack.licenseSource}</span>
                  {pack.private ? <span>Private</span> : null}
                  {pack.source.url ? (
                    <a href={pack.source.url} rel="noreferrer">
                      {pack.source.label}
                    </a>
                  ) : (
                    <span>{pack.source.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
