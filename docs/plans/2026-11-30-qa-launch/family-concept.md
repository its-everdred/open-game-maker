# What a "family" is in OGM today

Kevin asked (2026-11-27): "do we have a concept of a family? if so what does it do? i didn't intend for one, i imagined
a single group of users in a hosted instance of OGM". Yes: it came in with the v1 build (accounts, OGM-012) and every
game and budget hangs off it. Read from `packages/policy/src/authorize.ts`, `services/api/src/auth/principal.ts`,
`accounts/families.ts`, `invites/`, `games/`, `budget/`, `jobs/scheduler.ts`, `rooms/rooms.ts`, `analytics/`.

## What it does

- **Every user is in at most one family, and every game belongs to one.** A new game goes into its creator's family.
  The prod instance has two: Kevin's ("Weaver QA", with Kevin and one other account) and, until today, the QA account's
  own. Joining a second family is refused (`already_in_family`), and nothing lets a family's owner leave it.
- **The family is a wall around games.** Almost every game route checks that the game is in the viewer's family
  (`cross_family`, or a 404). Someone outside the family can't open, play or edit its games, even listed ones. The one
  exception is a room invite, and only when the family allows friends.
- **Inside the family, a game's visibility decides who plays it.** A *listed* game is playable by every member. A
  *private* game is playable only by its owner and by people holding a per-game grant, which comes from accepting a
  "play" invitation. Dusk Helm and Blobs are private, so other members of Kevin's family can't play them without a
  grant. Only the owner edits or publishes a game, plus a maintainer for an audited action.
- **Roles mostly come from the allow list, not the family.** Who may sign in, and whether they are a player, maker
  or admin, is the instance allow list (Admin › Users). The family stores a role (owner/admin/member) and a capability
  (creator/player), but sign-in uses the allow-list role for the capability and the platform admin.
- **Budgets are per family.** The daily Energy allowance, the daily platform cap and the job slots belong to the
  family, so all members share them: by default 1 New Game job and 3 edit jobs at a time, and a cap equal to the sum
  of the members' allowances. Weekly job limits (new games and edits) are per email address. Minerals (the Codex
  subscription window) and Gas (metered spend) are instance-wide provider meters with no family in them; admins get
  the 95 % warning mail.
- **Invites are family invites.** A "member" invite adds someone to the inviter's family. A "play" invite grants one
  of the family's games, and a "room" invite joins one multiplayer room. An admin can send any kind, and a creator
  can send play and room invites. Inviting someone outside the family to play needs the family's
  `friends_allowed` switch, which is off for both families.
- **Admin is scoped to the family.** The admin pages (members, budget, settings, analytics, abuse flags) only act on
  the admin's own family. Platform admin and maintainer come from the allow list and `OGM_MAINTAINER_EMAILS`.
  Admin › Users (the allow list) is the only instance-wide page, and a tester added there gets a member invite to the
  admin's family.
- **Analytics** (creator analytics, credits, the activity feed) count only games in the viewer's family.

## For "one group of users in a hosted instance"

Kevin's model already works in practice if every account sits in the same family, and that is what Admin › Users
does now: each tester joins the admin's family through its first-run invite. The QA account was the one exception,
and it is now a member too. Two ways to make it official:

1. **One default family that everyone joins (small; recommended for Monday).** The QA tooling and Admin › Users
   already do this. To finish it: have the QA account's own setup (`ensureQaAccount`) join the instance family
   instead of making one, hide or remove the "create family" route (`POST /api/v1/families`), and rename the family
   to the instance name. Code that checks families stays, so nothing in authorisation changes.
2. **Remove the family boundary (large; later).** `family_id` is on games, members, invitations, jobs, allowances,
   the budget ledger, budget settings, drafts, abuse flags and activity events, and every route and test checks it.
   Removing it means a migration, a policy rewrite and broad test changes, and it gives up the option of hosting a
   second separate group on one server.

Risks with option 1 (some apply already):

- **Shared slots and caps.** Everyone, the QA account included, shares one family's New Game slot (1 at a time),
  its 3 edit slots and its daily cap. The daily New Game QA run and the Energy probe now queue behind Kevin's jobs
  and count toward his cap. Raise the slots or the cap in Admin › Budget if that bites.
- **Private games still need grants.** A member can't play a private game without a play invite. For testers to
  play Dusk Helm and Blobs, either make them listed or send each tester a play invite. A third option is a policy
  change: "any member may play any family game".
- **Admins see everyone.** Every admin sees every member, every budget and the whole family's analytics. That is
  fine for one trusted group, but wrong if strangers ever join the same instance.
- **No way back out.** An owner can't leave a family, and there is no command for moving a person or game between
  families. Moving the QA account needed a one-off step (below).

## QA account move (2026-11-27)

Kevin's member invite was created and accepted by the app's own `createInvitation`/`acceptInvitation` code, run
from a one-off script as Kevin's principal. Two steps had no app path. Removing the QA account's owner membership of
its old family came first, because accept refuses a user who already has a family. Moving the "QA Review" game came
second: it went with its owner, because editing is family-scoped, and the QA state now names Kevin's family. Kevin's
"play" invites for Dusk Helm and Blobs were then accepted the same way, which gave the QA account its grants. The old
"QA" family is left in place, empty apart from its 4 old budget-ledger rows. The DB backup is
`~/.local/share/ogm/data/ogm.sqlite3.bak-qa-family-20261128T001843Z`.
