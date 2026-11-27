import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import type { Release } from '@ogm/contracts/browser';

import { getGame } from '../../../features/editor/api';
import { useBuilds, useVersionBranches } from '../versions/api';
import { publishableBuild } from '../versions/rules';
import { PublishDialog } from './PublishDialog';
import { usePublishChecks, useReleases } from './api';
import { RollbackDialog } from './RollbackDialog';
import '../versions/versioning.css';
import './releases.css';

export function ReleasesScreen() {
  const { gameId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const branches = useVersionBranches(gameId);
  const builds = useBuilds(gameId);
  const releases = useReleases(gameId);
  const checks = usePublishChecks(gameId);
  const game = useQuery({ queryKey: ['game', gameId], queryFn: () => getGame(gameId), enabled: gameId !== '' });
  const [publishingBuildId, setPublishingBuildId] = useState<string>();
  const [rollback, setRollback] = useState<Release>();
  const rows = branches.data ?? [];
  const selectedId = searchParams.get('v');
  const current = rows.find(({ id }) => id === selectedId) ?? rows.find(({ name }) => name === 'main') ?? rows[0];
  const eligibleBuild = current ? publishableBuild(current, builds.data ?? []) : undefined;
  const history = [...(releases.data ?? [])].reverse();
  const published = history[0];
  const gamePath = `/g/${encodeURIComponent(gameId)}`;
  const returnToGame = () => navigate(current ? `${gamePath}?v=${encodeURIComponent(current.id)}` : gamePath);

  return (
    <section className="versioning-screen release-screen" aria-labelledby="releases-title">
      <header className="versioning-head">
        <button className="back tap-primary" type="button" onClick={returnToGame}>
          Back
        </button>
        <h1 id="releases-title">Releases</h1>
        {current?.name === 'main' ? (
          <button
            className="tap-primary release-publish"
            type="button"
            disabled={eligibleBuild === undefined || game.data === undefined}
            onClick={() => setPublishingBuildId(eligibleBuild?.id)}
          >
            Publish
          </button>
        ) : null}
      </header>

      <div className="versioning-body release-body">
        {branches.isPending || builds.isPending || releases.isPending || game.isPending ? (
          <p className="versioning-state">Loading releases…</p>
        ) : null}
        {branches.isError || builds.isError || releases.isError || game.isError ? (
          <p className="versioning-state" role="alert">
            Releases unavailable.{' '}
            <button
              type="button"
              onClick={() =>
                void Promise.all([branches.refetch(), builds.refetch(), releases.refetch(), game.refetch()])
              }
            >
              Try again
            </button>
          </p>
        ) : null}
        {!releases.isPending && !releases.isError && history.length === 0 ? (
          <p className="versioning-state">Nothing published yet.</p>
        ) : null}
        {published ? (
          <section className="published-release" aria-label="Published release">
            <span>Published</span>
            <h2>{published.version}</h2>
            <p>{published.changelog.summary}</p>
          </section>
        ) : null}
        {history.length > 0 ? (
          <div className="release-history" aria-label="Release history">
            {history.map((release) => (
              <article key={release.id} aria-label={`${release.version} release`}>
                <header>
                  <div>
                    <h2>{release.version}</h2>
                    <p>{new Date(release.publishedAt).toLocaleDateString()}</p>
                  </div>
                  <span>{release.kind}</span>
                </header>
                <p>{release.changelog.summary}</p>
                {release.changelog.items.length > 0 ? (
                  <ul>
                    {release.changelog.items.map((item, index) => (
                      <li key={`${item.kind}:${item.text}:${index}`}>{item.text}</li>
                    ))}
                  </ul>
                ) : null}
                {release.id !== published?.id ? (
                  <button className="tap-secondary" type="button" onClick={() => setRollback(release)}>
                    Roll back to {release.version}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
        {checks.isError ? (
          <p className="versioning-state" role="alert">
            Publish checks unavailable.
          </p>
        ) : null}
        {checks.data && checks.data.length > 0 ? (
          <section aria-label="Publish checks">
            <h2>Publish checks</h2>
            {checks.data.map((record) => (
              <article key={record.id}>
                <p>
                  {record.result} · {record.surface} · {record.gitSha} · {new Date(record.createdAt).toLocaleString()}
                </p>
                <p>Publish: {record.publishResult}</p>
                {record.buildId ? <p>Build {record.buildId}</p> : null}
                {record.sizes.length > 0 ? <p>Sizes: {record.sizes.join(', ')}</p> : null}
                <ul>
                  {record.checks.map((check) => (
                    <li key={check.name}>
                      {check.name}: {check.result}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        ) : null}
      </div>

      {publishingBuildId && game.data ? (
        <PublishDialog
          gameId={gameId}
          buildId={publishingBuildId}
          publicRepo={game.data.repoVisibility === 'public'}
          onPublished={returnToGame}
          onClose={() => setPublishingBuildId(undefined)}
        />
      ) : null}
      {rollback ? (
        <RollbackDialog
          gameId={gameId}
          release={rollback}
          onRolledBack={returnToGame}
          onClose={() => setRollback(undefined)}
        />
      ) : null}
    </section>
  );
}
