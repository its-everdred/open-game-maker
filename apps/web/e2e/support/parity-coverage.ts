/** Monday and existing artboards in docs/design/ogm-glass/screens.md, at available native sizes. */
export const requiredParityArtboards = [
  'Main-1440x1700',
  'Components-1440x1560',
  'Title-780x1688',
  'SignIn-780x1688',
  'Join-780x1688',
  'Account-780x1688',
  'Home-780x1688',
  'GameSheet-780x1688',
  'NewGame-780x1688',
  'NewGameChat-780x1688',
  'PlayView-780x1688',
  'PauseMenu-780x1688',
  'Editor-780x1688',
  'EditMenu-780x1688',
  'AgentChat-780x1688',
  'VoiceLive-780x1688',
  'BugReport-780x1688',
  'Review-780x1688',
  'Activity-780x1688',
  'TicketChat-780x1688',
  'BuildOrder-780x1688',
  'Settings-780x1688',
  'Resources-780x1688',
  'LimitReached-780x1688',
  'Publish-780x1688',
  'Admin-780x1688',
  'AdminInvite-780x1688',
  'HomeDesktop-1440x900',
  'HomeLandscape-844x390',
  'EditorDesktop-1440x900',
  'EditorLandscape-844x390',
  'PauseLandscape-844x390',
  'BuildOrderDesktop-1440x900',
] as const;

type Capture = { name: string; screen: string };

/** A reference is covered only when a selected capture actually targets it. */
export function missingParityCoverage(
  required: readonly string[],
  references: readonly string[],
  captures: readonly Capture[],
  selectedScreens: ReadonlySet<string>,
) {
  const names = new Set(references.map((file) => file.replace(/\.png$/, '')));
  const expected = new Set([...required, ...names]);
  const captured = new Set(
    captures.filter((target) => selectedScreens.has(target.screen)).map((target) => target.name),
  );
  return {
    missingReferences: [...expected].filter((name) => !names.has(name)).sort(),
    missingCaptures: [...expected].filter((name) => !captured.has(name)).sort(),
  };
}
