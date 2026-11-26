read and pull out and prioritize tickets for codex:

Open Game Maker / aiur — November 26 context dump for Claude Executor

Scope: Everything material discussed after the November 25, ~22:00Z voice context document, through the completed OGM Game Scout and Open Armor Scout first-pass reviews and Kevin’s subsequent request for inexpensive generated fantasy armor on November 26, 2026.
Audience: OGM Executor; share relevant aiur decisions with the aiur Executor.
Authority: The user’s latest instructions in this document override earlier assistant recommendations and the implementation-oriented wording of the research appendix. The appendix is retained as evidence and possible future planning material, not a work order.

New action for Claude: Begin the further armor feasibility research in section 3.2: investigate a series of World of Warcraft-style fantasy armor tiers, first as image mocks and then as simple generated models for Dusk Helm, aiming for a few cents per usable set if feasible. Kevin does not need highly detailed models. Research is authorized; no new paid generation allowance or pack purchase has been approved. The external-game implementation hold below remains in force.

0. Read this first: external-game work is research-only

Kevin’s latest instruction:

> these are not final decisions about which to import, only a cursory first pass to tell claude which i’m interest in digging into deeper, play as is to learn if i actually like it, and inform what approach we might take to build both an OGM import flow and what sorts of shims we will need to build to add the OGM pause and controller support to each game so we can see how we might abstract and generalize. … i only want claude to keep research about the external game support work but don’t start anything yet.

Do not start external-game support implementation. Retain the research and use the preferences to guide deeper investigation and existing-game playtesting. Do not create or dispatch implementation tickets, fork or install games into OGM, add catalog entries as supported, implement adapters/shims, change OGM’s runtime or save service for this initiative, deploy services, or commit to new spending. The research-only hold applies to the entire external-game initiative, including the earlier proposed importer, catalog, browser/WASM, cloud-save and second-host acceptance work. A like is not approval to import. A pass is not a permanent rejection. No ranking or final first wave has been selected. No new work authorization should be inferred from earlier recommendations, from the fact that a game has a browser build, or from a visual review.

Preserve the findings for later; Kevin wants to play the original games as they exist today before choosing what is worth integrating. Deeper research may compare source/build paths, original gameplay, existing input/pause/save behavior, and possible abstractions. It must not silently turn into implementation. Prefer existing public playable builds and documentation; do not provision new services, accept new terms, purchase anything, or modify upstream or OGM repositories for this work. If a meaningful test requires installation/building beyond the research-only scope, surface the requirement and wait for direction. Existing unrelated OGM/Dusk Helm/aiur work remains governed by its prior priorities and approvals; this handoff is not a request to pause the entire fleet or reprioritize it around external games.

1. Starting context: November 25 voice document

This is a snapshot of the briefing Kevin supplied, not a fresh production audit. The four games in Open-Games are Dusk Helm, Blobs VS Blocks, Goblin Cellar and RestoreBound. The NUC hosts the fleet and services, including the Zomboid server; the PC/RTX 4080 was described in this briefing as the render-only studio. aiur orchestrates workers and tickets; OGM supplies the game factory, CLI, skills, asset pipeline, app, review flow and marketing site.

Priorities from November 24, unchanged by this conversation:

1. Dusk Helm playable on Kevin’s phone.
2. Pixel-art weapon and armor models reviewed in the engine.
3. Attack animations (core #1282).
4. End-to-end playability (OG #22 first-half route and OG #4 combat arena).
5. Rest of Dusk Helm.
6. Everything else.

The briefing also listed the marketing site (core #1355, Assembly Line mock B), docs (#1361), map-search fix (#1352) and Dusk Helm Play-button fix (OG #1021) as P1. One agent slot is reserved for voice and in-app review until both work on Kevin’s actual phone; the remaining fleet continues other work. This is a previously confirmed allocation, not a new global launch blocker.

Reported state at the time of that document:

• Codex resumed after the November 25 16:28Z reset; Open-Games 3/3 and core 2/2 slots. Merges and publishes were flowing. Camp/Riverbank/dungeon path #991, contact feedback #873, review-card chat step 1 #1330, asset intake hang #1357 and marketing site #1356 were reported merged.
• Dusk Helm had repeated failed production Play checks since November 24: loading at roughly 60%, no Play button, touch controls over title. OG #1021 P1. Walk animation, sound, campfire, HUD globes, three buttons and collision-box feedback remained queued; HUD/orbs PR #763 was merging. Do not confuse published builds with working gameplay.
• Map search #1352 was running; 2,117 imported maps had not been searchable because the index contained zero layouts. Blobs multiplayer OG #1025 had code but no two-phone production proof or completed public rooms hosting.
• Leartes/Hivemind intake and render studio were reported working; NoAI packs stay out of image generation. Pixel mask #1338 remained unsatisfactory (C3 closest, outlines too thick, faces grey, automatic mask required). Visual decisions belong in the review flow, not voice.
• Voice still failed for Kevin. OGM core #932/#1087 depended on aiur #8049. The aiur section reported #8049 code-complete in stall-12, blocked on green security-advisory PR #8116 merging. Notifications #8034/PR #8117 were in stall-12, requiring event export. Review-card chat depended on #8082, with send/read slices and later media/verdict/voice-fork work still pending. These were estimates and pin states at briefing time, not verified current status.
• aiur reported #8114 ci-wait stalls still open, retry priority fix #8113 and usage reset fix #8118 in pins, reserved-slot support #8115 in stall-12 (agent.reserved_slots: {"slot:voice-review": 1}). Multi-project gateways had foundations merged but no production migration/soak. CI security fix #8116 was waiting on Kevin. No new merge permission was granted here.
• Full review UI reportedly existed but was not phone-accepted. Preserve the earlier decision to run the artifact review page and in-app review in parallel until genuine parity. Push had never reached Kevin’s phone. A new artifact review page had recovered eight overnight picks.

Recurring issues remain relevant: Codex capacity stalls, stale usage after reset, stuck ci-wait, merge conflicts, priority inversion, unread review picks, silent QA failures, NUC overload and unnecessary Claude token burn. These were discussed in the supplied document; no new ops direction was given in this session.

2. Actual new voice decisions and unanswered questions

2.1 Shared voice backend and replaceable frontend — approved direction

Kevin’s exact instruction:

> as for voice, i think aiur should ship both backend functionality and unopinionated frontend components, taking care to make visuals easy to replace. OGM should avoid repeating work, but should skin the component to match OGM designs

• aiur owns the reusable voice/chat backend functionality and unopinionated frontend components. Design the UI layer so consumers can replace visuals without reimplementing voice, state, transport or conversation behavior.
• OGM consumes and skins those components to fit its own design system. Avoid a parallel OGM-specific voice implementation or duplicating behavior. A shared component does not require every consuming app to have the same appearance.
• This is an architectural decision, not a new approval to bypass aiur, ship a duplicate vendored implementation, merge arbitrary PRs, or declare the feature done. Earlier interim-composer proposals should be reconciled with this newer instruction by the Executor. Existing phone acceptance and the one reserved voice/review slot remain in force.
• Suggested implementation interpretation (not a prescribed API): separate behavior/state from styling/render slots, allow host-supplied controls, and keep voice/attachment/error semantics shared. Let aiur determine the actual component contract and OGM integrate it.

2.2 Quaternius $20 Source tier — deferred, not approved

The Quaternius Source-tier purchase question was passed/deferred. Kevin explicitly corrected any interpretation that he had approved it. Do not buy Quaternius. The subsequent request for a link was informational, not a purchase authorization.

Link shown: Quaternius Modular Character Outfits: Fantasy. The assistant reported the Source edition as $20 with editable Blender files. Kevin said the pack does not have enough range and requested broader armor libraries instead (section 3).

2.3 Original November 25 direction questions: disposition

The conversation did not complete the latest voice questionnaire. Do not treat assistant recommendations as Kevin’s decisions.

|Original OGM question                                   |Status after this conversation                                                                                                     |
|--------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
|1. Dusk Helm vs marketing/docs fleet allocation         |Unanswered; previous priorities remain.                                                                                            |
|2. Launch readiness / first audience                    |Unanswered.                                                                                                                        |
|3. Is two-way voice required before launch?             |Unanswered; the shared component decision does not answer launch gating.                                                           |
|4. Retire artifact review page this month?              |No new answer; previous decision remains: keep both until true parity and phone acceptance.                                        |
|5. OGM interim version vs shared aiur dependency        |Approved architecture: aiur supplies backend and unopinionated frontend, OGM skins/reuses; no blanket interim duplication approval.|
|6. Claude/Codex capacity allocation and paid accounts   |Unanswered; no new spending/account authorization.                                                                                 |
|7. Pause RestoreBound/Goblin Cellar?                    |Unanswered.                                                                                                                        |
|8. Blobs online as launch feature / hosting             |Unanswered.                                                                                                                        |
|9. New 3D packs’ role in product                        |No general answer; armor aesthetic preference below is narrower.                                                                   |
|10. Executor autonomy for deletion/spending/terms/merges|Unanswered; existing approval boundaries remain.                                                                                   |

|Original aiur question                             |Status                                                          |
|---------------------------------------------------|----------------------------------------------------------------|
|1. Retire artifact/relay after #8082 send/read?    |No new answer; prior parallel-review/parity requirement remains.|
|2. Voice fork read-only vs steer worker mid-call   |Unanswered.                                                     |
|3. MPG migration vs further stall/dispatch fixes   |No new answer; earlier reliability-first direction remains.     |
|4. Push categories (review_ready/stalled/live/info)|Unanswered.                                                     |
|5. Executor merge permission for green aiur PRs    |Unanswered; do not infer approval to merge #8116 or other PRs.  |

For any future voice session: one short question at a time, recommended answer first; defer visual choices to review. Kevin specifically asked the assistant not to speak while he was not ready. Do not re-ask already answered decisions or substitute questions from stale documents.

3. Dusk Helm armor-library research

User’s direction

Kevin wants much more than clothing or a handful of outfits. His request was for full fantasy armor and gear with the breadth of World of Warcraft-style equipment tiers: recognizable progression from basic to elaborate equipment, full suits, and class identities. Search Humble, itch.io, other asset stores/libraries and open-source models. He particularly liked the N-Hance aesthetic and then requested alternatives in that style that allow AI use.

The desired visual direction is expressive, stylized fantasy armor: strong silhouettes, decorated plate and shoulders, robes, leather, helmets, and equipment appropriate for Warrior, Wizard and Ranger. Kevin’s latest clarification is that Dusk Helm does not need highly detailed models. Distinctive class and equipment-tier designs should read at the actual game camera and pixel scale with simple geometry. N-Hance is a visual reference, not a purchase decision. The original SSI style and automatic pixel-treatment direction still apply in Dusk Helm. No new pixel-mask choice, asset pack purchase, spending allowance, account creation or acceptance of terms was approved.

Initial wider armor search (historical research results)

These are the assistant’s reported November 26 research findings, not freshly rechecked prices or license guarantees. Check current listing, source/asset terms and compatibility before any use or purchase.

|Library                                                                                                                                                              |Reported range / price                                                                                             |Relevance / caveat                                                                                                                                                                                                                                                            |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|[Blink Character & Armor Bundle](https://assetstore.unity.com/packages/3d/characters/humanoids/fantasy/character-armor-bundle-for-stylized-fantasy-rpg-338552)       |$399.99; two main armor bundles each with 15 distinct sets plus variants, 510 prefabs advertised, compatible bodies|Broad modular ecosystem; not 510 unique suits. Some Fab listings NoAI. Individual bundles need Blink bodies.                                                                                                                                                                  |
|[Polytope Modular Armors Bundle](https://assetstore.unity.com/packages/3d/characters/humanoids/low-poly-modular-armors-bundle-lowpoly-medieval-fantasy-series-230383)|$129.99; 1,200+ components; base set has three upgrade tiers                                                       |Strong explicit progression, simpler low-poly look than N-Hance. Shared humanoid rig, animations not included. [Free sample](https://assetstore.unity.com/packages/3d/characters/low-poly-modular-armors-free-lowpoly-medieval-fantasy-series-199890). AI terms not confirmed.|
|[N-Hance Outfits Pack #2](https://www.fab.com/listings/e7d0a41a-d0b5-4063-8b36-df8c61189d61)                                                                         |$129.99 reported for four modular sets, compatible base extra; human bases $64.99 reported                         |Preferred visual style. Elaborate Paladin/Battle Mage/Hunter and other outfits have individual NoAI flags in checked listings. Do not feed restricted assets into generation.                                                                                                 |
|[Infinity PBR 13-pack Fantasy RPG bundle](https://infinitypbr.com/packs/complete-13-pack-bundle)                                                                     |$179.50 sale / $359 regular reported; armor pack 2 has five designs, 20 textures                                   |More realistic, coordinated wardrobe. AI terms not confirmed.                                                                                                                                                                                                                 |
|[Quin.GS Modular Knights](https://quin-gs.itch.io/knights)                                                                                                           |$7.50; 68 skinned components, 57 animations                                                                        |Inexpensive knight supplement, not full three-class range. AI terms not confirmed.                                                                                                                                                                                            |

Open/editable leads from the initial search:

• Medieval Humans, Orcs & Goblins: CC0, 13 armor/robe sets, raw FBX; experimental clipping/cloth, limited animations, hair shader WebGL issues.
• Flare hero and heroine: layered cloth/leather/steel, weapons and eight-direction animations; original hero package CC-BY 3.0. Updated Blender source has per-file credits/licenses. Relevant to sprite rendering, limited armor breadth.
• System G6 modular RPG characters: CC0, approximately 45 animations each; not a documented large armor-tier catalog.
• holokat/game-assets: 50 archived armor designs, 168 GLB variants, procedural Three.js source, MIT for project-authored material; fitting to arbitrary rigs not automatic.

No currently purchasable Humble armor bundle meeting this need was verified. The existing Leartes/Hivemind bundles are largely environments and props, not full equipment wardrobes. Synty Modular Fantasy Hero Characters appeared in a prior Humble bundle, but Synty’s standard direct/Humble license was reported to restrict game-creation software and some generative-AI use; do not assume it is appropriate for OGM without a suitable license.

Follow-up: N-Hance-like options with explicit AI-use permission

|Candidate                                                                                                                                                       |Research finding                                                                                                                                                                                                                                                                                    |Limitations                                                                                                                                                                            |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|[Master Character Creator (Soft Kitty)](https://www.fab.com/listings/ff618db0-2120-4d84-af3a-9bb5bb0d7006)                                                      |Closest new stylistic match according to assistant. Fab listing AI use Yes. [Inventory](https://www.soft-kitty.com/docs/master-character-creator/overview/): upper armor 19 male/15 female, lower pieces 19/15, boots 21/20, gauntlets 19, helmets 15.                                              |Unity $600 reference; Fab checkout price not verified. Full customization toolkit, not just armor. Counts include body fits. AI permission was checked on Fab, not automatically Unity.|
|[Easy Grind Fantasy Modular Armor Sets](https://www.fab.com/listings/1cc8a15c-8ae6-4689-853f-ce51a3b62a8c?lang=en)                                              |21 full sets (heavy/medium/light), 126 parts, tinting/cloaks, Fab AI use Yes.                                                                                                                                                                                                                       |More realistic than N-Hance. Unreal/MetaHuman proportions; bodies not included. Need export/refit and independent body rights. Price not established.                                  |
|[Atlant Games ROG Modular Medieval Armor](https://www.fab.com/listings/77a7d8cb-6236-439d-865d-8eceb731fa85)                                                    |220 equipment items/components/variants, named armor families, Fab AI use Yes.                                                                                                                                                                                                                      |Grounded medieval style, less exaggerated fantasy; not 220 full suits.                                                                                                                 |
|[N-Hance Newbie Outfits](https://www.fab.com/listings/f62f2639-c21d-49d0-9772-719b6d642b56)                                                                     |Four modular sets and 21 weapons, Fab AI use Yes.                                                                                                                                                                                                                                                   |Starting gear only; not full desired progression.                                                                                                                                      |
|[N-Hance Modular Orc Female](https://www.fab.com/listings/fc97be80-7d47-4ba4-a97d-a8cf82b299bf)                                                                 |Fab AI use Yes.                                                                                                                                                                                                                                                                                     |Individual listing only; does not clear other N-Hance bases or armor.                                                                                                                  |
|[N-Hance Weapons #1](https://www.fab.com/listings/170089a2-33cf-4ba8-b4ad-f8e46f07cc44), [#2](https://www.fab.com/listings/0e1a076a-ecc4-44f3-8468-97d98200a60d)|42 and 69 weapons/equipment pieces respectively; both reported Fab AI use Yes.                                                                                                                                                                                                                      |Useful matching weapons, not full armor range.                                                                                                                                         |
|[Ryzom official art](https://github.com/ryzom/ryzomcore_graphics)                                                                                               |Open MMO source; [armor catalog](https://en.wiki.ryzom.com/wiki/List_of_armors) has four cultures × light/medium/heavy × three quality tiers = 36 named regular plans, plus special gear. CC-BY-SA 3.0 and Free Art License 1.3; [Blender conversion](https://sourceforge.net/projects/ryzomblend/).|Older organic fantasy look; cleanup, fitting, attribution/share-alike and per-asset terms. 36 plans not verified as 36 independent meshes.                                             |

The assistant recommended visually comparing Master Character Creator and Easy Grind before spending, and checking the free Polytope sample for fitting if appropriate. These are research recommendations only. Kevin subsequently submitted preliminary armor review preferences (section 3.1); no pack was approved for purchase. A listing’s AI-use Yes does not establish unrestricted redistribution, rights to separately sourced character bodies, or permission to offer raw commercial assets through a game-maker product. Preserve NoAI exclusion for Leartes/Hivemind/Fab products where applicable, check the actual license of each asset, and do not treat a product-wide/publisher-wide assumption as clearance. Fab EULA.

Kevin has now expressly requested further armor feasibility research (section 3.2). A meaningful proposed comparison would show the same Warrior/Wizard/Ranger across several gear levels, at the actual camera/pixel scale and with representative animations. The research request does not approve purchases or paid asset production.

3.1 Open Armor Scout — completed preliminary visual review (November 26)

Kevin requested a separate Tinder-style visual review of armor collections, with vendor imagery, prices and an always-visible selectable export text field. After a standalone HTML version did not load images in his preview, an in-chat review was provided. Kevin submitted the complete result below. These are research preferences only; no purchase or asset-integration approval. All eight cards were reviewed; three Like, four Pass, one Later. No notes were supplied.

|Choice|Collection                     |Previously reported price (USD; not freshly verified)                                    |Source / follow-up                                                                                                                                                                                               |
|------|-------------------------------|-----------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|LIKE  |N-Hance Newbie Outfits         |$129.99 regular / $38.99 reported sale                                                   |[Fab](https://www.fab.com/listings/f62f2639-c21d-49d0-9772-719b6d642b56); investigate compatible base requirements and full license; four starter sets alone do not meet the desired gear-tier breadth.          |
|LIKE  |Ryzom MMO Equipment            |Free                                                                                     |[Official art source](https://github.com/ryzom/ryzomcore_graphics); inspect actual equipment meshes, conversion/fitting effort, attribution and share-alike obligations.                                         |
|LIKE  |N-Hance Fantasy Weapons 1 & 2  |#1 $25.99 Unity reference, Fab price unverified; #2 $39.99 regular / $11.99 reported sale|[Pack 1](https://www.fab.com/listings/170089a2-33cf-4ba8-b4ad-f8e46f07cc44), [Pack 2](https://www.fab.com/listings/0e1a076a-ecc4-44f3-8468-97d98200a60d); weapon libraries, not substitutes for full armor tiers.|
|PASS  |Master Character Creator       |$600 Unity reference; Fab price unverified                                               |[Fab](https://www.fab.com/listings/ff618db0-2120-4d84-af3a-9bb5bb0d7006)                                                                                                                                         |
|PASS  |ROG Modular Medieval Armor     |$249.99 regular / $124.99 reported sale                                                  |[Fab](https://www.fab.com/listings/77a7d8cb-6236-439d-865d-8eceb731fa85)                                                                                                                                         |
|PASS  |Medieval Humans, Orcs & Goblins|Free                                                                                     |[itch.io](https://algumacoisaqq.itch.io/medieval-humans-orcs-goblins-rigged)                                                                                                                                     |
|PASS  |Flare Hero & Heroine           |Free                                                                                     |[OpenGameArt](https://opengameart.org/content/isometric-hero-and-heroine)                                                                                                                                        |
|LATER |Fantasy Modular Armor Sets     |Unverified                                                                               |[Fab](https://www.fab.com/listings/1cc8a15c-8ae6-4689-853f-ce51a3b62a8c); defer; 21 sets, MetaHuman fitting dependency.                                                                                          |

The user did not state reasons for individual votes. Do not infer them from the prices or earlier assistant recommendations. The prior recommendations favoring Master Character Creator and Easy Grind are superseded for shortlist prioritization by the user’s actual review results. Preserve the desired N-Hance-like visual direction and WoW-style tier breadth. A free library still requires license/provenance and compatibility review; an AI-use Yes field is not permission to redistribute source assets. No spending, new terms, asset intake or implementation is authorized merely by these votes. The separately requested armor research below is authorized.

3.2 New request: research inexpensive generated fantasy armor tiers — begin now

Kevin’s latest instruction, in his words:

> i said to tell claude about my fantasy armor, wow style preferences. ask it to do further research and see if generating a series of armor sets in mocks and then in fab is doable for a few pennies. we don’t need highly detailed models for dusk helm.

Decision: approved research request. Begin further research into whether the existing image-to-3D pipeline can produce a coherent series of full fantasy armor sets cheaply enough for Dusk Helm. This is additional to researching purchasable or open armor libraries. The three liked armor cards remain preferences; none has been selected for purchase or integration.

Provider wording: Kevin said “fab.” Given the earlier 3D-generation work, the working interpretation is fal, the generation service already used by the project. Fab is the asset marketplace also discussed in the armor search. This interpretation is not an exact correction of Kevin’s words. Check it against the existing pipeline before selecting a service; keep marketplace research and generation-cost research distinct.

Desired result

• A series of original, coherent full gear sets with the breadth and progression feel of World of Warcraft equipment, using N-Hance as the preferred stylistic reference. Cover the existing Warrior, Wizard and Ranger identities; Kevin has not specified the number of sets or tiers.
• Clear differences in silhouettes, colors, materials and class identity between basic and more elaborate gear. This is about fantasy armor and equipment, including plate, shoulders, helmets, robes, leather and complementary weapons, rather than another small clothes wardrobe.
• Simple models suited to Dusk Helm’s pixel presentation and actual phone viewing scale. Expensive sculpt detail, high polygon counts and fine texture detail are not requirements. Assess how much can be expressed through silhouettes, broad color areas and reusable parts.
• A route that fits the existing heroes and animation work. An attractive static mesh alone does not demonstrate usable equipment: account for body fit, rig attachment or skinning, clipping during core moves and the final pixel treatment.

Research the proposed mock-to-model sequence

1. Concept series: determine how to generate and review a coherent collection of armor image mocks, maintaining a common body, style and tier progression. Use the standard visual review flow. Any references sent to generation must be permitted for that use; existing NoAI exclusions still apply. Named games are private visual references, not a request to reproduce their exact assets.
2. Simple model generation: investigate converting approved concepts through the existing fal/3D pipeline, reusing existing tooling where practical. Establish whether the outputs can be separate, usable armor parts or tend to merge armor and body into one mesh, and what that means for the current character system.
3. Fitting and presentation: estimate the work to make those outputs usable on the current heroes and to render them in the chosen Dusk Helm presentation. Keep the existing real-3D-versus-sprite comparison separate; this armor request does not resolve that decision or authorize a renderer redesign.
4. Small proposed validation: recommend the smallest useful trial and the evidence Kevin should see before expanding production: a concept, the resulting model at game scale, and fitting/animation evidence where needed. Do not generate a whole collection just to establish whether the pipeline is viable.

These are investigation questions and a proposed validation sequence, not an instruction to start paid generation now.

Cost question to answer honestly

“A few pennies” is the desired economics to investigate, not a verified price or a spending cap. Show the expected cost per usable full set, while also distinguishing charges per image, per mesh and per separate equipment part. Include mock generation, model generation, likely retries, any chargeable fitting/rigging step and rendering/export costs. Report agent or manual cleanup effort separately so a cheap raw mesh does not conceal an expensive production process.

The earlier November 21 briefing reported a roughly $0.02 TRELLIS model-generation result. That is historical project context, not current pricing, proof that armor generation works, a complete fitted-set cost or an unused allowance. Verify the current model, settings, terms and price before recommending a trial. If the target economics are unrealistic, say which step dominates and propose the closest practical route, including reuse of permitted existing parts where useful.

What Claude should return

A compact feasibility recommendation with: the best existing pipeline to try; its limitations for modular armor; a realistic cost range per usable set; the simplest quality level that should read well in Dusk Helm; and a small, explicitly priced test proposal. Distinguish documented capability, prior project evidence and untested assumptions. Research can begin immediately. Request approval before new paid generation or purchases, consistent with Kevin’s standing spending rule. No batch size, new budget, production run or new account has been approved here.

The external-game support hold in section 0 does not block this armor research. Continue already authorized Dusk Helm/OGM/aiur work under its existing priorities.

3.3 Review-flow feedback to preserve

For both game and armor scouting, Kevin wants a quick visual like/pass/later review, real images or clips, and an always-visible selectable text export of names and choices. Armor cards also need prices, clearly distinguishing a verified current offer, a historical price and an unknown price. He reported missing armor images and a non-working game export button. The pasted exports in this handoff are the authoritative choices; no direct access to live voting state is assumed. Preserve this feedback without claiming that the preview/export problems were fixed or that new OGM review implementation was authorized by the temporary research decks.

4. Unrelated research: PokeMMO and historical Pokémon reverse engineering

Kevin explicitly introduced this as unrelated. Do not turn it into an OGM feature, Pokémon import request, or work ticket.

• PokeMMO was reported as a small-team project started in early 2012, with contemporary credits Desu, Shu, Squirtle and Gizmo. The assistant could not verify salaries/full-time employment. Its July 2012 announcement identifies Java, FireRed as the initial foundation, and separate graphics/combat engines. No evidence was found that it relied on a complete pret decompilation. Contemporary report.
• Earlier Pokémon reverse engineering predates recent ports: Red disassembly history shows January 2010 work; Crystal rebuildable assembly was discussed in May 2014; Ruby/Sapphire matching C was reported 20% complete in January 2017. pret projects include both assembly and C reconstructions. These are milestones, not claims of full completion on those dates.
• A disassembly reconstructs assembly instructions; matching C decompilation reconstructs compilable high-level code matching the original binary, not original comments/names. An independent engine can read game data and implement behavior without a full decompilation. No legal permission to redistribute Pokémon assets follows from this history.

5. External game support: product direction, not implementation approval

5.1 What Kevin asked to explore

The original research request was inspired by Little City: find recently popular open-source Three.js games, search widely including Twitter/X, assess player reception and compatibility, and show screenshots/animations in a Tinder-style like/pass review. The aim is to understand the least-effort path for an OGM instance host to flag a game from an OSS repository and eventually play it with the standard OGM experience: Games list, agent chat, a default editor with no game-specific controls yet, OGM controller support and pause menus. RestoreBound’s import from the Finn repo is the reference for the intended low-friction experience, not a requirement to copy its source layout.

Kevin then broadened the search to established open alternatives to recognizable games (OpenRCT2, open Civilization, Minecraft-like games and other gaming pillars). The small viral Three.js demos alone were not recognizable enough. Prefer substantial, well-liked games; keep popular but difficult/infrastructure-heavy games visible with their blockers. Three.js is not a hard requirement; existing client-side browser/WASM games are useful comparisons. Social attention, stars, actual player ratings and quality of browser ports must remain separate measures.

5.2 Repository and extensibility model — confirmed

Kevin explicitly said:

> OGM should fork the repo but still keep it self contained, i don’t want to pull it fully into open-games
> 
> but OGM should be capable of extending the game, adding editor mode etc

One independent, editable upstream fork per imported game/host. Preserve upstream history, source layout, original build toolchain and dependencies. Register that fork and its build with OGM; never absorb the full game into open-games. Agents must target the fork’s actual source for features, fixes, and later editor mode/custom controls. The initial editor is a real preview + agent conversation + normal change/review workflow; no pretend visual object controls. This is not a read-only iframe catalog. Keep upstream and host-local changes distinguishable, with future update/rollback paths.

5.3 Supported-game catalog and reusable shims — confirmed direction, future work only

Kevin explicitly requested a catalog of suggested supported games and said that when support is added, the shim should be packaged. Distinguish a shared supported catalog from the installed Games list and from this research deck. Future catalog entries should advertise tested versions, licenses, real screenshots/clips, devices/controls, editor/save capabilities and known limitations. Each supported game should have a versioned adapter/recipe containing reusable lifecycle/input/audio/save integration, build configuration, required source patches and verification checks. Another host should be able to select a supported game and get a separate editable fork with the existing integration rather than paying agents to redo it. Keep game-specific host modifications in the fork. Reusable compatibility fixes can become tested shim releases; do not publish local game changes by default.

The suggested future proof is a second clean OGM instance installing the same supported entry without writing new adapter code. This is an acceptance concept for later, not an instruction to start the proof now.

5.4 Client-side first, standardized cloud saves

Kevin wants to avoid a fleet of game-specific backend services and databases. Prefer games whose simulation runs on the client and whose assets can be hosted as static builds. For a sufficiently valuable game, he may consider replacing a game-specific database with the existing OGM database and making standardized cloud saves a native OGM feature. This is conditional interest, not blanket approval to migrate databases, deploy services or build the save feature now.

Research distinction: a database swap can remove duplicated persistence/profile infrastructure but cannot replace an authoritative multiplayer simulation, matchmaking, world server or required external service. For solo games, keep native save formats where possible and use a common OGM persistence contract. For example, a Luanti world’s own database can be a local save artifact; it need not be converted block-by-block into OGM tables. Persistent shared worlds still need server authority. Record what can be local, what is optional online functionality, and what is truly essential.

6. Game Scout first-pass preferences — 38 reviewed, 26 likes, 12 passes

These are not final decisions about which to import. The user wants to play originals and learn which are actually enjoyable, then use the technical findings to decide how the importer and shims should be generalized. The following is the exact game-name/ID/choice content of Kevin’s pasted export, in its original order. All 38 notes were empty; no Later choices or unreviewed entries appear in this export. The repository links are the export’s source pointers; license strings are preliminary snapshots (full research appendix below). No game is certified supported, and no purchase, installation, fork, deployment or import is authorized. Do not use the earlier assistant’s proposed first wave as a substitute for these preferences.

|# |Game / source                                                                |Game ID                  |First-pass choice|License label from export (not reverified)                                                                                          |updatedAt (export)|
|-:|-----------------------------------------------------------------------------|-------------------------|-----------------|------------------------------------------------------------------------------------------------------------------------------------|-----------------:|
|1 |[Mineclonia on Luanti](https://codeberg.org/mineclonia/mineclonia)           |`mineclonia`             |**like**         |Game GPL-3.0-or-later; media CC-BY-SA-4.0; Luanti LGPL-2.1-or-later plus component/media notices                                    |1795672254748     |
|2 |[OpenTTD](https://github.com/OpenTTD/OpenTTD)                                |`openttd`                |**like**         |GPL-2.0 engine; free base sets have separate open licenses                                                                          |1795672262215     |
|3 |[OpenRCT2](https://github.com/OpenRCT2/OpenRCT2)                             |`openrct2`               |**like**         |GPL-3.0-or-later engine; original game content remains proprietary                                                                  |1795672264745     |
|4 |[Unciv](https://github.com/yairm210/Unciv)                                   |`unciv`                  |**like**         |MPL-2.0 source; media licenses per asset, not Firaxis assets                                                                        |1795672267242     |
|5 |[shapez](https://github.com/tobspr-games/shapez.io)                          |`shapez`                 |**like**         |GPL-3.0; retain asset notices                                                                                                       |1795672269772     |
|6 |[VoxeLibre on Luanti](https://github.com/VoxeLibre/VoxeLibre)                |`voxelibre`              |**like**         |Game GPL-3.0-or-later; media mostly CC-BY-SA-4.0 with per-file notices; Luanti LGPL-2.1-or-later                                    |1795672273015     |
|7 |[SuperTux](https://github.com/SuperTux/supertux)                             |`supertux`               |**like**         |GPL-3.0; most game data also CC-BY-SA, preserve per-asset notices                                                                   |1795672276867     |
|8 |[SuperTuxKart](https://github.com/supertuxkart/stk-code)                     |`supertuxkart`           |**pass**         |Code GPL-3.0-or-later; data CC-BY-SA, CC-BY, CC0, GPL and public domain with per-asset notices                                      |1795672280891     |
|9 |[Freedoom / Doom-compatible engine](https://github.com/freedoom/freedoom)    |`freedoom`               |**pass**         |Freedoom data BSD-style license; Dwasm engine GPL-2.0                                                                               |1795672285016     |
|10|[Warzone 2100](https://github.com/Warzone2100/warzone2100)                   |`warzone2100`            |**like**         |GPL family; see COPYING/data notices                                                                                                |1795672288399     |
|11|[Freeciv](https://github.com/freeciv/freeciv)                                |`freeciv`                |**like**         |GPL-2.0-or-later desktop engine; Freeciv-web client is AGPL                                                                         |1795672291877     |
|12|[ClassiCube](https://github.com/ClassiCube/ClassiCube)                       |`classicube`             |**pass**         |BSD-style code; separate asset review                                                                                               |1795672301813     |
|13|[3d.city / Micropolis](https://github.com/lo-th/3d.city)                     |`3d-city`                |**like**         |GPL-3.0-derived; metadata conflict                                                                                                  |1795672321282     |
|14|[Mindustry](https://github.com/Anuken/Mindustry)                             |`mindustry`              |**pass**         |GPL-3.0 game; asset attribution must be preserved; separate legacy CheerpJ runtime terms require review if used                     |1795672330549     |
|15|[OpenFront](https://github.com/openfrontio/OpenFrontIO)                      |`openfront`              |**like**         |AGPL-3.0 code with additional notices/name terms; resources CC BY-SA 4.0; proprietary and external assets excluded from open license|1795672337369     |
|16|[The Battle for Wesnoth](https://github.com/wesnoth/wesnoth)                 |`wesnoth`                |**like**         |GPL-2.0-or-later code; GPL / CC BY-SA art with specific asset notices                                                               |1795672342957     |
|17|[FreeCol / BrowserCol](https://github.com/shivan2418/browsercol)             |`browsercol`             |**like**         |GPL-2.0-or-later fork; artwork/music mostly GPL plus per-file CC BY / BY-SA                                                         |1795672346184     |
|18|[Endless Sky](https://github.com/endless-sky/endless-sky)                    |`endless-sky`            |**like**         |GPL-3.0 + per-asset open licenses                                                                                                   |1795672349058     |
|19|[Shattered Pixel Dungeon](https://github.com/00-Evan/shattered-pixel-dungeon)|`shattered-pixel-dungeon`|**pass**         |GPL-3.0                                                                                                                             |1795672351830     |
|20|[OpenMW / Morrowind](https://github.com/OpenMW/openmw)                       |`openmw`                 |**pass**         |GPL-3.0 engine/port; commercial Morrowind data must be supplied by the owner                                                        |1795672353631     |
|21|[OpenLara / Tomb Raider](https://github.com/XProger/OpenLara)                |`openlara`               |**pass**         |BSD-2-Clause engine; Tomb Raider content remains proprietary                                                                        |1795672356134     |
|22|[OpenRA](https://github.com/OpenRA/OpenRA)                                   |`openra`                 |**pass**         |GPL-3.0-or-later engine; original EA content has separate freeware/proprietary terms                                                |1795672363318     |
|23|[0 A.D.](https://gitea.wildfiregames.com/0ad/0ad)                            |`0ad`                    |**pass**         |GPL-2.0-or-later code; CC BY-SA 3.0 art with resource-specific notices                                                              |1795672368016     |
|24|[Veloren](https://github.com/veloren/veloren)                                |`veloren`                |**pass**         |GPL-3.0 game; asset-specific notices; experimental port repository needs its own patch licensing review                             |1795672371056     |
|25|[DevilutionX / Diablo](https://github.com/diasurgical/DevilutionX)           |`devilutionx`            |**like**         |Current Sustainable Use License: non-commercial/source-available; original Blizzard data separately proprietary                     |1795672373560     |
|26|[Little City](https://github.com/yaoderek/littlecity)                        |`littlecity`             |**like**         |MIT                                                                                                                                 |1795672377321     |
|27|[Baron](https://github.com/dai-studio/ex-baron)                              |`baron`                  |**like**         |BSD-2-Clause                                                                                                                        |1795672394201     |
|28|[REGOLITH](https://github.com/winchxyz/moon-rover)                           |`regolith`               |**pass**         |MIT                                                                                                                                 |1795672404017     |
|29|[Oil Paint](https://patch.gg/blendi/oil-paint/files)                         |`oil-paint`              |**like**         |MIT                                                                                                                                 |1795672429985     |
|30|[Server Survival](https://github.com/pshenok/server-survival)                |`server-survival`        |**like**         |MIT                                                                                                                                 |1795672438704     |
|31|[Painted Valley](https://patch.gg/blendi/painted-valley/files)               |`painted-valley`         |**like**         |MIT                                                                                                                                 |1795672447351     |
|32|[Valley Ride](https://github.com/StarKnightt/valley-ride)                    |`valley-ride`            |**pass**         |MIT                                                                                                                                 |1795672453336     |
|33|[pmndrs Racing](https://github.com/pmndrs/racing-game)                       |`pmndrs-racing`          |**like**         |MIT                                                                                                                                 |1795672456170     |
|34|[Cuberun](https://github.com/akarlsten/cuberun)                              |`cuberun`                |**like**         |MIT                                                                                                                                 |1795672458802     |
|35|[SYNTHBLAST](https://github.com/brianrisk/SYNTHBLAST-threejs-game)           |`synthblast`             |**like**         |Apache-2.0                                                                                                                          |1795672460810     |
|36|[Claude of Duty](https://github.com/mshumer/Claude-of-Duty)                  |`claude-duty`            |**like**         |MIT                                                                                                                                 |1795672462735     |
|37|[Cayley](https://github.com/lauramionel/cayley-flight-simulator)             |`cayley`                 |**like**         |MIT                                                                                                                                 |1795672464392     |
|38|[Pillar Valley](https://github.com/EvanBacon/pillar-valley)                  |`pillar-valley`          |**like**         |MIT                                                                                                                                 |1795672466149     |

How to interpret these choices

The established-game likes include both Minecraft survival variants, OpenTTD, OpenRCT2, Unciv, Freeciv, shapez, SuperTux, Warzone 2100, 3d.city, OpenFront, Wesnoth, BrowserCol, Endless Sky and DevilutionX. The browser-native/smaller-project likes include Little City, Baron, Oil Paint, Server Survival, Painted Valley, pmndrs Racing, Cuberun, SYNTHBLAST, Claude of Duty, Cayley and Pillar Valley. This grouping is for research convenience, not an ordering or ranking.

Freedoom was an assistant-recommended engineering pilot but Kevin passed on it. Do not carry forward that earlier recommendation as an approved first-wave choice. Similarly, likes on DevilutionX and OpenRCT2 do not remove their rights/data gates; likes on Luanti, OpenFront and other technically complex games do not remove their infrastructure/porting gates. Oil Paint and Painted Valley are exploration/scene foundations, not complete campaign games. Preserve those distinctions rather than promising a uniform experience.

The Game Scout review deck was built for this research. It had 38 cards with creator media, Like/Pass/Later, notes, undo and filters. Kevin reported the Export picks button did nothing and requested a selectable, automatically updated text field listing names and choices. The assistant could not update the hosted deck in that session. Kevin subsequently pasted the export directly; it is the authoritative preference record above. No need to rebuild the deck, reset votes or add an OGM feature ticket for this temporary review tool.

7. What deeper research should establish before any future implementation decision

This is a proposed research framework derived from Kevin’s latest intent, not a new build plan or commitment. Do not implement a universal adapter spec based solely on these hypotheses.

7.1 Product fit: play originals first

For each liked candidate, preserve links to the original game and source, and identify the simplest existing legitimate way to play it as-is (browser demo, official desktop/mobile build, or documented community port). Identify any commercial game data, account, paid purchase, browser feature or native install requirement up front. Kevin wants to decide if he actually likes the game through play, not just screenshots. Record his eventual gameplay impressions separately from these initial votes. Do not assume that a public demo loading means the game is playable on his phone or inside OGM.

A useful per-game research card would contain: what the player actually does, depth/completeness of gameplay, how to play unchanged, target devices, genuine player-review evidence where available, and the questions that would matter for Kevin’s eventual decision. Keep actual screenshots and gameplay clips attributable to their source; distinguish native screenshots from browser gameplay. No AI-generated gameplay evidence. The existing appendix already contains source pointers and estimates; reuse it rather than repeat the entire discovery exercise.

7.2 Technical fit: compare representative integration families

The useful question is not simply “how do we import 26 games?” It is “which behaviors are shared, and which require game-specific hooks?” The following are research examples, not selected pilots or a priority queue:

|Integration family                             |Liked examples                                  |What to investigate without changing code                                                                                                                                                                           |
|-----------------------------------------------|------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Browser-native JS/Three.js                     |Little City, Baron, Server Survival, SYNTHBLAST |Existing frame loop, input/action APIs, native pause, audio scheduling, build packaging, local state; Baron already reports touch/gamepad/pause.                                                                    |
|React/R3F or alternative web runtime           |pmndrs Racing, Cuberun, Pillar Valley           |React lifecycle, physics/RAF, event routing, existing online dependencies, legacy build tooling, WebGPU/mobile gates.                                                                                               |
|Established browser-native strategy            |shapez, OpenFront, 3d.city                      |Simulation worker vs render loop, pointer/menu navigation, construction gestures, turn/state persistence, optional services.                                                                                        |
|Existing Emscripten/WASM                       |OpenTTD, SuperTux, Warzone 2100                 |Compiler/build recipes, virtual filesystem, engine loop, input event translation, thread isolation, true pause and native savefiles.                                                                                |
|New/community browser ports                    |Unciv, Freeciv, BrowserCol, Wesnoth, Endless Sky|Upstream/port revision relationship, missing features, browser compatibility, local workers, save/export paths and UI suitability.                                                                                  |
|Shared engine with multiple game packs         |Mineclonia and VoxeLibre on Luanti              |Common runtime and game-pack-specific validation, memory/thread requirements, native world saves, solo vs shared-world server.                                                                                      |
|Engine reimplementation requiring original data|OpenRCT2, DevilutionX                           |License and content gates, private lawful data loading, port maturity, separate treatment of engine and assets. DevilutionX current noncommercial/source-available terms are a blocker for unrestricted catalog use.|
|Scene foundations / external-data experiments  |Oil Paint, Painted Valley, Cayley               |Whether there is a complete game, public source acquisition and rights, external services/data terms, missing gameplay and controls.                                                                                |

For each family, compare actual upstream interfaces for:

• Mount/unmount and readiness: canvas, workers, render loop, resize, disposal and remount.
• Pause/resume: does the original already expose pause? What simulation clocks, physics, timers, workers, animation and audio need to stop? How does it behave on background/app switch? A host overlay alone is not a real pause. Online authoritative simulation cannot be paused as if it were local.
• Controller/touch: original keyboard, pointer, touch, gamepad and analog inputs; direct action APIs vs keyboard synthesis; button edges, held-state release, dead zones, pointer/selection/building/menu controls, focus and duplicate readers. Compare action games with dense strategy UI rather than assume one layout works everywhere.
• Audio/settings: user gesture unlock, music/effects volume, mute, pause vs permanent settings, disposal of independent audio graphs.
• Save/restore: native export/import, JS state, localStorage/IndexedDB or WASM filesystem; format, safe checkpoints, size, migration and branch compatibility. Record what is already implemented and what is only a proposal.
• Hosting: static client assets vs essential remote dependencies, optional online services, authoritative world/match servers, databases, authentication and external data licenses. Note the minimum solo path and operating cost separately.
• Extensibility: source structure, build lockfile, asset provenance, practical code-edit entry points, and how a future editor might expose real data rather than pretend every scene is editable.

Compare the findings across games to identify likely reusable host contracts, engine-family helpers, game-specific shims and optional capabilities. A game with its own pause API may need only a binding; another may require explicit loop gating. A game with native gamepad support may need action mapping, while a pointer-heavy sim needs meaningful menu/build controls. A common SDK contract is plausible, but the actual abstraction should be informed by these differences rather than prematurely invented. Do not implement any of this until Kevin explicitly chooses to proceed.

7.3 Important findings already in the attached research

The previous source audit was pinned to OGM commit 12245a540d5ac79893fc531d8be884b773d8260f; it is not current production acceptance. It found existing registration/publish commands, per-repo agent routing, SDK lifecycle, game host, default preview/chat workspace, and save infrastructure. Several paths still assume games/<slug> and need future standalone-root support across registration, PR boundaries, commit/design operations, preview/publish and daemon profiles. Do not solve by copying whole games into the monorepo or globally disabling write boundaries.

The audit also found OGM’s existing SQLite/Drizzle save stack with authenticated user/game/slot identity, revisions, leases and compatibility metadata. A 512 KiB compressed API limit and a roughly 262k-character bridge message limit constrain larger worlds; current save hooks are synchronous and the inspected app does not use the durable SDK outbox. These are future research/implementation considerations, not work to start now. A native game save format can remain opaque to OGM. Reuse the host’s persistence instead of introducing a DB per game where practical. Browser threading/isolation, WASM feature support, memory and iPhone/Safari constraints are separate from whether the source is open.

RestoreBound’s original its-everdred/finn source was inspected at b5fa04939db88154292417a8fa1619267083a9e8: Kaboom 3000.1.17, static 320×240 canvas, inline/unpkg bootstrap, touch-to-keyboard input, localStorage state and independent Web Audio. OGM’s test confirms the real RestoreBound replaced the placeholder. The actual installed adapter in open-games was not accessible to the research session. The Executor can use its own access to inspect the real adapter later; do not claim the original import method already solves standalone forks.

The research includes a 5–10 engineer-day estimate for the narrow shared source-root/fork/build/chat foundation, plus per-game ranges and additional WASM/save/catalog work. These are historical analyst estimates, not a budget or schedule. No actual OGM import or runtime compatibility test was performed. Direct X access was limited, and original media was used because the research browser could not provide reliable fresh WebGL captures. See the full evidence below.

8. Handoff checklist and authority boundary

• Confirmed product direction: aiur provides shared backend and replaceable frontend; OGM skins it. Quaternius is deferred. Kevin wants a N-Hance-like, World of Warcraft-style range of full fantasy armor tiers; highly detailed models are unnecessary for Dusk Helm. Existing voice/review slot and phone acceptance stay in force.
• Begin the newly requested armor research: investigate coherent image mocks followed by inexpensive generated models, likely through the existing fal pipeline. Assess the complete cost and fitting effort per usable set. Return a small priced trial proposal; obtain approval before new paid generation or purchases. Preserve all eight armor votes: three likes, four passes and one later.
• Confirmed future external-game design direction: standalone editable forks, OGM agent editing and default editor, packaged reusable shims and supported catalog, client-side first, potential common cloud saves.
• Not confirmed: any external game import, ranking, pilot, implementation ticket, budget, purchase, new account, service, merge policy, or new launch gate. All 38 votes are preliminary.
• Permitted external-game activity now: retain this research; investigate original games and compare potential integration approaches within the research-only boundary. Let Kevin play originals and supply further preferences. Do not launch an implementation project.
• Other work: this handoff does not change existing Dusk Helm/OGM/aiur priorities or authorizations. The remaining voice questions are unanswered as marked above.

────────

Research appendix — full November 26 external-game spike

ARCHIVED RESEARCH / NOT AN EXECUTION PLAN. The following is the complete substantive earlier research report, including its source citations, all 38 candidate profiles, exclusions, architectural audit, historical estimates and proposed future acceptance criteria. It predates Kevin’s latest votes and explicit research-only hold. Its suggested pilots, proposed ticket names, and implementation-oriented wording are retained solely as reference. They do not authorize any work. The latest preference table and section 0 above control. In particular, the old suggested Freedoom pilot was passed on; no pilot is approved. The old final implementation directive has been replaced with a research-only status note to prevent accidental dispatch.

Open Game Maker — open-source game import research spike

Research date: 26 November 2026.
Updated direction: established games first; independent editable forks, reusable catalog shims, client-side execution and shared OGM cloud saves.
Status at original research time: research and proposed future implementation handoff (now research-only; see controlling instructions above). No game was forked, installed, imported or deployed into OGM; no implementation tickets were filed. Source inspections and documented browser builds are not live OGM or phone acceptance.

1. Recommendation and requirements

Prioritize established games with an existing browser build, including WebAssembly ports. Three.js is useful for the original discovery request but is not an admission requirement: a complete, well-liked game with a reproducible browser port can be a better product than a new Three.js demo. Keep every imported game in its own independent, editable fork, with its source, history, assets, lockfile and build toolchain. OGM should register and host the resulting artifact, provide preview/chat and lifecycle integration, and package the adapter for reuse by another instance. Do not absorb games into open-games.

The revised first choices are OpenTTD for a recognizable, substantial simulation; SuperTux or Freedoom for a smaller action-game lifecycle proof; and shapez for a popular browser-native strategy game. These are recommended investigation targets, not support certifications. OpenTTD has an upstream Emscripten target and free replacement assets; SuperTux provides an official web build; Freedoom provides original free campaigns for a browser Doom engine; shapez already has a browser implementation. Their specific constraints and primary sources follow below.

Run bounded viability spikes for Unciv, Freeciv’s local-worker WASM port, and the Luanti/Mineclonia/VoxeLibre family. These address the recognizable Civilization and Minecraft experiences Kevin requested, but their new or experimental browser routes should pass meaningful play/save tests before receiving integration estimates as commitments. OpenRCT2 is a strong conditional follow-up: the engine can be adapted for browser solo play, while each player must supply appropriately obtained commercial game data. OpenMW, OpenLara and VCMI need similarly explicit data and browser gates. Games that require persistent world servers stay visible as infrastructure exceptions rather than disappearing from the comparison.

The original Little City/Baron/REGOLITH recommendations remain useful low-cost alternatives and are preserved in sections 4–5. They no longer define the first wave. Final selection should follow Kevin’s visual preferences and the viability gates, with popularity treated separately from browser compatibility.

Requirements retained from the conversation

• An instance host can flag an open-source repository or choose from a curated catalog of suggested supported games.
• OGM creates a standalone fork, preserving upstream identity and history. It must build and run without a sibling open-games checkout.
• The initial editor has a real game preview and agent chat, with no fabricated game-specific visual controls. Agents can change the original source immediately; visual editors can be added later.
• OGM’s controls, pause/settings, audio and save UI connect to real game behavior. A framed canvas or controller overlay alone does not establish support.
• Each completed integration produces a versioned, reusable shim and installation recipe. A second instance can install that support without repeating adapter development.
• Prefer client-side games and the existing OGM services. Avoid a separate backend/database for every game. A worthwhile major game may justify an explicitly scoped exception.
• Expand the existing OGM save stack into standardized imported-game cloud saves. Replace duplicative save/profile services where practical, while distinguishing them from servers that actually run a game world or match.
• Ordinary gameplay must not create AI/token or third-party API spending. Host purchases, new services and paid capacity require their own decisions.

Effort framing: all ranges below are analyst estimates after the necessary shared foundations, not measured delivery times. They exclude unverified phone usability, full controller parity, custom visual editors and multiplayer unless stated. The earlier 5–10 engineer-day importer estimate covers a narrow source-root/fork/build/chat foundation only. It does not cover the complete WASM runtime, large-save work, mobile adaptation, catalog release process, second-host proof or native ports. Re-estimate those slices after the first bounded build tests.

Review deck: OGM Game Scout now contains 38 cards: 25 established-game/family candidates plus the original 13. Like, Pass, Later, Undo, notes and JSON export capture preferences; they do not install a game or authorize a purchase. Actual project media is attributed on the cards. A native screenshot is labeled as such and does not prove a browser build; no synthetic screenshots are used as gameplay evidence.

2. Twenty-five established-game comparisons

The table compares the implementation path, not just whether a game has public source. “Static solo” means no game-specific hosted simulation is inherently needed for the selected solo route; OGM itself still supplies hosting, authentication and optional saves. “Community” and “experimental” ports require a reproducibility gate. Each row links its main source; the profiles provide the specific web-port and rights evidence.

|Game                                                                         |Familiar appeal                    |Browser route                       |Solo infrastructure                 |Rights distinction                      |Adapter estimate / decision        |
|-----------------------------------------------------------------------------|-----------------------------------|------------------------------------|------------------------------------|----------------------------------------|-----------------------------------|
|[Mineclonia on Luanti](https://codeberg.org/mineclonia/mineclonia)           |Minecraft-style survival           |Experimental Luanti WASM            |Static solo; server for shared world|GPL game / CC BY-SA media               |Spike → 2–4 weeks desktop family   |
|[OpenTTD](https://github.com/OpenTTD/OpenTTD)                                |Transport Tycoon-style simulation  |Upstream Emscripten target          |Static solo                         |GPL; free base sets available           |1–2 weeks; first simulation        |
|[OpenRCT2](https://github.com/OpenRCT2/OpenRCT2)                             |RollerCoaster Tycoon 2             |Community browser builds            |Static solo                         |GPL engine; own RCT2 data               |2–4 weeks; data/build gate         |
|[Unciv](https://github.com/yairm210/Unciv)                                   |Civilization-style strategy        |New upstream TeaVM browser target   |Static vanilla solo                 |MPL source; separate open art           |Spike → 1–3 weeks                  |
|[shapez](https://github.com/tobspr-games/shapez.io)                          |Factory automation                 |Original browser-native game        |Static solo                         |GPL; retain asset notices               |1–2 weeks; early candidate         |
|[VoxeLibre on Luanti](https://github.com/VoxeLibre/VoxeLibre)                |Minecraft-style survival variant   |Same experimental Luanti route      |Static solo; server for shared world|GPL game; mostly CC BY-SA media         |Share family work; pack proof extra|
|[SuperTux](https://github.com/SuperTux/supertux)                             |Full side-scrolling platformer     |Official WASM web releases          |Static solo                         |GPL / CC BY-SA data notices             |3–7 days; first action candidate   |
|[SuperTuxKart](https://github.com/supertuxkart/stk-code)                     |Kart racing                        |Community Emscripten derivative     |Static solo; online disabled        |GPL; mixed open asset licenses          |1–2 weeks                          |
|[Freedoom / Doom-compatible engine](https://github.com/freedoom/freedoom)    |Original free Doom-style campaigns |Dwasm/PrBoomX browser engine        |Static solo                         |BSD-style data; GPL engine              |3–7 days; first action alternative |
|[Warzone 2100](https://github.com/Warzone2100/warzone2100)                   |Established 3D RTS                 |Official WebAssembly edition        |Static campaign/skirmish            |GPL family; data notices                |1–3 weeks                          |
|[Freeciv](https://github.com/freeciv/freeciv)                                |Civilization-style strategy        |Community client + server in workers|Static solo; avoid heavy web stack  |GPL engine; AGPL separate web client    |Spike → 2–3 weeks                  |
|[ClassiCube](https://github.com/ClassiCube/ClassiCube)                       |Classic voxel construction         |Official browser client             |Static solo                         |BSD-style code; resource audit          |1–2 weeks; creative-only           |
|[3d.city / Micropolis](https://github.com/lo-th/3d.city)                     |SimCity/Micropolis lineage         |Three.js + local simulation worker  |Static solo                         |Actual GPL license vs MIT README        |1–3 weeks; save/license gate       |
|[Mindustry](https://github.com/Anuken/Mindustry)                             |Factory/tower defense              |Experimental TeaVM port             |Intended static solo                |GPL; runtime/asset notices              |Spike → 1–3 weeks                  |
|[OpenFront](https://github.com/openfrontio/OpenFrontIO)                      |Online territory-strategy lineage  |Browser-native local solo worker    |Strip service calls; MP server      |AGPL; restricted assets excluded        |1–3 weeks solo                     |
|[The Battle for Wesnoth](https://github.com/wesnoth/wesnoth)                 |Campaign turn-based strategy       |Community Emscripten fork           |Static campaigns                    |GPL / CC BY-SA data notices             |2–4 weeks                          |
|[FreeCol / BrowserCol](https://github.com/shivan2418/browsercol)             |FreeCol/Colonization-style strategy|New TeaVM WASM-GC fork              |Client + AI/server local workers    |GPL fork; mixed open media              |2–3 weeks                          |
|[Endless Sky](https://github.com/endless-sky/endless-sky)                    |Space trading and combat           |Community Endless Web fork          |Static solo                         |GPL; per-asset open licenses            |2–4 weeks                          |
|[Shattered Pixel Dungeon](https://github.com/00-Evan/shattered-pixel-dungeon)|Established mobile roguelike       |Experimental TeaVM web fork         |Static solo                         |GPL; retain notices                     |Spike → 1–2 weeks                  |
|[OpenMW / Morrowind](https://github.com/OpenMW/openmw)                       |Morrowind engine                   |Third-party WASM64 desktop port     |Static solo + private game data     |GPL engine; own Morrowind data          |1–3 weeks desktop; no phone promise|
|[OpenLara / Tomb Raider](https://github.com/XProger/OpenLara)                |Tomb Raider engine                 |Upstream WebGL demo/build           |Static solo                         |BSD engine; original data proprietary   |Spike → 1–2 weeks                  |
|[OpenRA](https://github.com/OpenRA/OpenRA)                                   |Command & Conquer-style RTS        |Community playRA browser fork       |Requires native match server        |GPL engine; EA data separate            |2–4 weeks + services               |
|[0 A.D.](https://gitea.wildfiregames.com/0ad/0ad)                            |Historical RTS                     |Experimental WASM fork              |Intended local solo                 |GPL code / CC BY-SA art                 |Port/performance research          |
|[Veloren](https://github.com/veloren/veloren)                                |Voxel action RPG                   |Browser experiment not playable     |Server/bridge in experiment         |GPL; port patch review                  |Porting research; defer            |
|[DevilutionX / Diablo](https://github.com/diasurgical/DevilutionX)           |Diablo engine                      |Emscripten web build                |Static solo                         |Current source-available terms; own data|Rights gate before estimate        |

There are stronger popularity signals here than in the first discovery pass: Mindustry has about 30,000 GitHub stars, OpenRA 17,800, OpenRCT2 16,600 and Unciv 11,600. Repository attention is not a player review score. Separate player evidence includes Unciv’s 4.8/5 across 378 itch ratings, shapez’s Steam “Overwhelmingly Positive” reception, and Wesnoth’s 94% positive English Steam reviews at the snapshot. These describe the upstream games, not the quality of small community browser forks. Sources are linked in the respective profiles.

3. Established-game profiles and implementation gates

3.1. Mineclonia on Luanti

Luanti is the engine; Mineclonia is a separate Lua game providing Minecraft-style survival. ContentDB showed 582,487 package downloads; the engine’s 13,894 stars are a different metric. Stable Luanti versions are supported by the game, while the inspected browser derivative is development-version code. A browser build bundling Minetest Game is not proof that Mineclonia runs. Pin engine, game, mods and save format together; prove world generation, crafting, inventory, save/reload and travel. The current inspected WASM flags require threads and JSPI with about 1.875 GiB initial memory: phone viability is unproven. See the bounded family spike below.

Primary evidence: Primary source 1 · Primary source 2 · Primary source 3 · Primary source 4 · Primary source 5 · Primary source 6 · Inspected browser build flags.

3.2. OpenTTD

The strongest recognizable simulation candidate: upstream supplies Emscripten build instructions, and solo gameplay does not need a hosted game server. Bundle free OpenGFX/OpenSFX/OpenMSX sets rather than commercial Transport Tycoon assets. Adapt native savefiles, record NewGRF/mod requirements, and route UI pointer/keyboard actions through OGM. Its 8,533 stars reflect an established project. Dense desktop menus require separate touch/controller design; the 1–2 week estimate is not an all-device promise. Verify a meaningful transport network survives cloud save and reload before calling the shim supported.

Primary evidence: Upstream repository and license · Upstream Emscripten build · Community web build and IndexedDB saves · Official media.

3.3. OpenRCT2

This is the theme-park game Kevin explicitly requested. The GPL engine has 16,609 stars, but the complete experience requires user-provided RCT2 files. Community browser routes exist; upstream source is not an official one-click web release. Reproduce one port and inspect its wrapper licenses: the older Mstrodl helper has no declared root license, while another 2026 browser fork provides an alternative. Keep original data out of catalog bundles and shims. Park saves, path/file handling, large menus and controller navigation are substantial adapter work; no dedicated database is inherently needed for solo.

Primary evidence: Official source / data requirement · Community web build tooling · Other public browser fork · Official site.

3.4. Unciv

The current upstream browser target matters: PR #15973 merged on November 12, 2026 and offers vanilla solo via TeaVM/JavaScript/WebGL. Choose this route over Docker/VNC, which would create a hosted desktop. Browser multiplayer is disabled and native feature parity is incomplete; audio, mods, sharing and long campaigns need proof. Existing upstream validation reached turn 6 with save/reload. The roughly 8 GiB compiler heap is a build requirement, not measured browser memory. Strong native reputation—11,645 stars and 4.8/5 itch ratings—justifies a bounded browser spike, not automatic certification.

Primary evidence: Repository · Browser merge and explicit limitations · Browser build instructions · Browser parity/validation status · Current browser issues · Player ratings · Browser merge metadata (API).

3.5. shapez

Use the original browser-capable shapez.io source, not shapez 2 and not the desktop-only Community Edition. The original has 7,015 stars and strong Steam player reception; its older Node 16/Yarn/Java/ffmpeg build requires a pinned reproduction before modernization. Solo has no essential gameplay server. Adapt factory save export, zoom/pan, construction gestures, hotkeys and simulation pause. Audit chosen browser-versus-Steam build flags and included content. This is an attractive early web-native integration, with comfortable controller building and phone UI scoped separately.

Primary evidence: Original source and browser build · Steam player reviews · Community Edition browser limitation.

3.6. VoxeLibre on Luanti

VoxeLibre is another full Lua game on Luanti, with its own weapons, structures, decorations and redstone-style systems. ContentDB showed 798,940 downloads; its canonical host is Mesehub, so the small GitHub mirror is not a fair popularity measure. Share engine/runtime/save infrastructure with Mineclonia, but test each game pack and world schema independently. Beta world-upgrade limitations matter. Solo can stay local; a persistent multiplayer world still needs a Luanti simulation server and browser networking adaptation. The same JSPI, threading and initial-memory limits apply to the inspected engine build.

Primary evidence: Primary source 1 · Primary source 2 · Primary source 3 · Primary source 4 · Primary source 5 · Inspected browser build flags.

3.7. SuperTux

A complete platform game with 3,220 stars and an official portal offering stable and nightly WASM builds. The official download page explicitly supports hosting its web build, stronger evidence than an unmaintained unofficial demo. Package its open assets with their notices, map movement/jump/menu actions, adapt saves and pause, and prove the chosen build inside OGM’s isolation policy. Applicable threaded builds need coordinated headers. Its built-in level editor is an optional later opportunity; initial OGM editing remains preview/chat. Recommend this for the smaller action-game proof.

Primary evidence: Primary source 1 · Primary source 2 · Primary source 3 · Primary source 4.

3.8. SuperTuxKart

The established project has 5,497 stars; its FAQ reports over five million downloads. The inspected community derivative builds version 1.5 for WebGL2 and explicitly removes threads, online play and add-ons. That makes solo static hosting plausible without a new gameplay service or that derivative’s needing thread isolation. Older port download/memory figures must not be reused as measurements of this newer build. Prove load, sustained racing, audio/pause and controls, then snapshot progress/config. Native screenshots do not establish phone performance or browser multiplayer.

Primary evidence: Primary source 1 · Primary source 2 · Primary source 3 · Primary source 4 · Primary source 5.

3.9. Freedoom / Doom-compatible engine

Freedoom supplies original free campaigns and assets; Dwasm supplies a PrBoom+/PrBoomX browser engine with static output. This avoids distributing commercial Doom WADs while exercising an established engine and savefile format. Keep data and engine licenses separate. Start with Dwasm’s software renderer because its documentation lists hardware-renderer defects. Map movement/aim/fire, menus and pause, then test save/reload. The port does not yet provide WebSocket multiplayer. Include accurate violence/gore tags; offer lawful user-data loading separately if original Doom campaigns are ever supported.

Primary evidence: Primary source 1 · Primary source 2 · Primary source 3 · Primary source 4.

3.10. Warzone 2100

Unlike many candidates, this maintained RTS has an official WebAssembly/WebGL2 edition. Campaign and skirmish are local; browser online multiplayer and mod-upload UI are absent. Its browser saves can be evicted, making OGM cloud persistence useful. Campaign cinematics stream on demand; self-host permitted resources or explicitly retain the dependency. Adapt RTS pointer selection, camera, menus and meaningful campaign saves. Native screenshots can exceed the web edition’s texture/media quality. Its 4,079 stars are project popularity, not evidence that OGM’s phone controls are ready.

Primary evidence: Official browser release · Web features, hardware and saves · Project screenshots · License and data terms.

3.11. Freeciv

Distinguish two architectures. Freeciv-web carries a native-server/web stack; the newer wasmga.me fork compiles both SDL client and game/AI server into the browser, with a Web Worker and MessagePorts. The latter is the client-first route. It targets 3.2.6 while upstream 3.2.7 is newer, and intentionally omits external multiplayer connections. Reproduce the pinned port, play meaningful turns and reload a campaign before budgeting full support. Calling its local worker a “server” does not mean OGM must host another process. Controller and small-screen navigation remain separate work.

Primary evidence: Official project · WASM fork · Port source instructions · Port author architecture and license notes · Browser play · Separate heavy Freeciv-web architecture · Pinned WASM port instructions.

3.12. ClassiCube

A real official browser client with self-hosting documentation and 2,100 stars. It is a classic creative-building game, not a full survival substitute: upstream explicitly excludes survival, modern Minecraft servers and Minecraft accounts. Solo can run without an account/game server. Resource downloads may reference Mojang-hosted content; choose a separately cleared resource pack rather than redistributing those assets under the engine’s BSD-style license. Map construction/cursor/menu controls and local-world saves. Multiplayer requires a compatible server/transport and is outside the minimal solo adapter.

Primary evidence: Project scope and no-survival statement · Browser self-hosting and touch guide · Full license notices.

3.13. 3d.city / Micropolis

An established browser-native SimCity/Micropolis lineage with 1,768 stars, Three.js rendering and local worker simulation. Two gates matter more than wrapping it: README says MIT while the actual license contains GPLv3/MicropolisJS and EA notices, and the roadmap lists save/load fixes. Resolve actual terms and verify serialization before advertising cloud saves; storage cannot repair a broken serializer. The simpler MicropolisJS upstream is another integration baseline. Bundle workers/assets, stop both rendering and simulation on pause, and support pointer-driven city tools.

Primary evidence: 3D game and screenshots · Actual license · Simpler MicropolisJS source.

3.14. Mindustry

Nearly 30,000 upstream stars and substantial gameplay make it worth investigating. Modern browser support is less mature: the community repo has a deprecated CheerpJ path and an unfinished TeaVM client-only path. Its marketing page and README differ over offline readiness; preserve that uncertainty. Do not revive a runtime with separate commercial terms simply to claim success. Mindustry Classic is an older official browser game, not modern-version parity. Require campaign progression, save/reload and known minimap/mod-startup checks before committing to the 1–3 week adapter range.

Primary evidence: Primary source 1 · Primary source 2 · Primary source 3 · Primary source 4 · Primary source 5 · Primary source 6.

3.15. OpenFront

Source inspection confirms single-player uses LocalServer and a browser simulation worker, while multiplayer uses remote transport. This supports a local-solo fork, not an unchanged offline production client: remove or replace upstream auth/store/cosmetics/ads, heartbeat, archive and remote-save calls. Binary snapshot hooks are useful but can exceed current OGM save limits. Code is AGPL with notice/name conditions; /resources is CC BY-SA, while /proprietary and premium external content are excluded. Modified forks need appropriate naming. Steam has about 1,500 mostly positive reviews; the publisher’s million-monthly-player figure remains an attributed claim.

Primary evidence: Official game repository · Current Steam reviews and publisher player-count claim · Local versus remote transport choice · Explicit browser-local solo heartbeat comment · Worker simulation and snapshot hook · Local turn scheduler and archive call · Asset licensing separation · Proprietary folder license · AGPL and additional naming/notice terms.

3.16. The Battle for Wesnoth

A mature campaign strategy game with 7,009 stars and strong Steam reviews, but its community browser fork has separate maturity. Use the source-backed rosebudai Emscripten build; another advertised port’s source link returned 404. The documented build supports threaded and single-thread options. Campaigns can run locally, with substantial licensed asset packaging/caching and save adaptation. The linked play page was not fetched successfully in this research, so reproduce the port before promising support. Large campaign completion and iPhone/Safari performance are unproven.

Primary evidence: Original source and license · Player reviews · Public browser fork build · Port author claims and unavailable fork pointer.

3.17. FreeCol / BrowserCol

BrowserCol ports FreeCol through TeaVM WASM-GC: client code runs in the page while server/AI runs in a Web Worker, yielding static solo distribution with IndexedDB saves. Optional AWS beta-feedback infrastructure can be removed in favor of OGM chat. The fork has three stars versus 728 for FreeCol; its interface and parity are evolving. Modern-browser requirements and Safari need proof. Upstream history is not fully retained in the vendored-source approach, so choose an explicit source-provenance/update strategy when making the OGM fork. No commercial Colonization files are required.

Primary evidence: Browser source and architecture · Browser site/media · Original FreeCol project.

3.18. Endless Sky

The established space-trading/combat game has 7,763 stars; Endless Web has 33. Pin the actual endless-web branch rather than inherited master, reproduce the browser build and choose between alternative port lineages deliberately. Solo simulation can remain local, with pilot/config files adapted to shared OGM saves. Large assets, ship controls, graphics behavior and browser memory increase QA scope. Community touch controls exist but do not demonstrate comfortable phone play. Preserve per-asset licenses and test restoration before startup reads pilot data.

Primary evidence: Upstream game · Browser fork · Playable browser page and save controls · Per-asset licenses.

3.19. Shattered Pixel Dungeon

Strong product fit for phones in its native form: 6,869 upstream stars and an established mobile roguelike. The experimental TeaVM/libGDX browser fork reports title, hero selection, first-floor exploration/combat and refresh/continue tests, not a complete run or mobile-browser validation. No fully verified hosted run was found. Reproduce it, test deeper progression and save compatibility, then connect save slots and OGM lifecycle. Native mobile quality does not transfer automatically to the browser; the fork had zero stars at the snapshot.

Primary evidence: Primary source 1 · Primary source 2 · Primary source 3.

3.20. OpenMW / Morrowind

A recent community WASM64 port gives this substantial RPG a desktop browser route. It needs modern Chromium/Firefox capabilities, SharedArrayBuffer/threads, WebGL2 and extension support; Safari/mobile are explicitly unsupported. Browser folder loading depends on Chromium’s File System Access API. Prefer standalone static solo with owner-provided Morrowind data and OGM saves; do not add the port’s separate account/cloud-locker stack by default. The free example world is not Morrowind. Experimental multiplayer needs a real headless authoritative engine plus extra services; a SQLite swap would not remove them.

Primary evidence: Primary source 1 · Primary source 2 · Primary source 3 · Primary source 4.

3.21. OpenLara / Tomb Raider

Upstream publishes a WebGL demo and an open BSD-licensed engine, but Tomb Raider levels, characters, music and other commercial data remain separate. Do not package demo content as freely licensed merely because a public URL serves it. Reproduce the browser build and lawful private data-loading path, then establish savefiles and lifecycle integration. Native ports are not proof of browser controller/touch support. The repository has 5,161 stars; current full gameplay and device acceptance were not executed in this research.

Primary evidence: Primary source 1 · Primary source 2 · Primary source 3.

3.22. OpenRA

Very recognizable, with 17,835 upstream stars, but the inspected playRA browser fork explicitly disables solo, skirmish, missions, saves and editor. It connects to native OpenRA servers through browser-compatible transport, so it belongs in the infrastructure-exception lane. OGM local pause cannot freeze an ongoing network match. EA freeware downloads retain separate distribution conditions; GPL engine rights do not make the assets open. The one-star browser fork does not inherit native maturity. Upstream also declines AI-generated contributions; do not promise agent edits will be accepted upstream.

Primary evidence: Official game/source · Browser port, disabled features and relay · Official media.

3.23. 0 A.D.

The official historical RTS is still primarily desktop; current development moved to Wildfire Gitea. A public Emscripten/WebGPU/WebGL2 fork exists, but its performance documentation leaves long-play acceptance pending. Local solo is the goal, not proof of a completed browser product. Investigate runtime, large assets, graphics and sustained simulation before quoting a small adapter. Replacing a database would solve none of those issues. The archived GitHub mirror’s 2,828 stars are not current browser adoption. Preserve GPL code and CC BY-SA art notices.

Primary evidence: Official project · 2026 release and license · Experimental browser source · Port performance acceptance remains pending.

3.24. Veloren

The native voxel RPG is popular—7,717 stars on its GitHub mirror—but the small third-party WebGPU experiment reports menu/login rendering followed by main-thread freezes while loading a world. It also uses a WebSocket bridge and authentication proxy to a real game server. This is not a playable client-only browser import. Keep it visible as a substantial future porting investment, with no near-term support promise. Cloud saves cannot repair the incomplete client or eliminate authoritative world simulation.

Primary evidence: Primary source 1 · Primary source 2 · Primary source 3 · Primary source 4.

3.25. DevilutionX / Diablo

A browser build exists and can run solo with local game data and saves. Current upstream terms are a Sustainable Use License, not an unrestricted OSI-style open-source grant; they include noncommercial/access-charging restrictions. Do not reuse older secondary “open source” labels. Full Diablo/Hellfire require owner-supplied MPQ files, and the web build displayed a prerelease warning. Its 10,047 stars show interest, but catalog/commercial compatibility is a rights gate first. Personal use may be possible under stated terms; that is different from approving distribution inside OGM.

Primary evidence: Primary source 1 · Primary source 2 · Primary source 3 · Primary source 4.

3.26. A bounded Minecraft-family proof

Start with a 1–2 engineer-day viability spike, not a promise to deliver a whole survival game in two days. Reproduce one pinned Luanti WASM build, load exactly one selected game pack, generate a world, move/craft/save/restore, and record the browser, peak memory, startup time and isolation requirements. Stop and report blockers if JSPI, threading, game compatibility or memory prevent this. The inspected build’s approximately 1.875 GiB initial memory is a concrete warning for phone targets; it is not a claim every possible Luanti web build needs that much.

If that succeeds, budget 2–4 engineer-weeks for a desktop-first Luanti family adapter after shared importer/runtime/save foundations. Package engine and game separately: engine revision, Mineclonia or VoxeLibre version, mods, licensed media and world-save compatibility. The second game should reuse runtime/lifecycle/filesystem support, with its own game-pack and upgrade tests; it is not automatically free to support. Phone adaptation and multiplayer are separately gated.

ClassiCube provides an easier official-web alternative when Kevin wants creative construction. Do not silently substitute it for survival/crafting/progression. For persistent shared worlds, either retain a clearly bounded Luanti server/protocol bridge as an approved exception or defer multiplayer. A cloud-save upload cannot provide a live shared simulation.

4. Original thirteen browser/Three.js candidates

Estimates are source-based engineering ranges after the shared importer exists. They include ordinary packaging, controls/lifecycle adaptation and focused desktop validation, but not major new gameplay, unverified phone usability or full controller parity. “Ready to scope” means a good investigation candidate, not certified OGM compatibility. License columns summarize source terms; asset qualifications remain material.

|Game           |Type and current stack                        |Rights summary                    |Attention snapshot        |Per-game estimate|Recommendation                     |
|---------------|----------------------------------------------|----------------------------------|--------------------------|-----------------|-----------------------------------|
|Little City    |Building sandbox; TS/Three/Vite               |MIT                               |3 stars; 963 X likes      |2–4 days         |Optional city-sandbox import       |
|Baron          |Arcade flight; TS/Three/WebGL2/Vite           |BSD-2-Clause                      |16 stars; 234 HN points   |1–3 days         |Optional small engineering pilot   |
|REGOLITH       |Lunar rover adventure; JS/Three r160          |MIT; procedural assets            |138 stars                 |3–7 days         |Optional exploration import        |
|Oil Paint      |Exploration/rendering scene; Three/Rapier/Vite|MIT code, CC0 art, Apache Rapier  |8,020 X likes             |2–4 days         |Scene foundation; non-GitHub source|
|Server Survival|Strategy; JS/Three/HTML HUD                   |MIT; music provenance unresolved  |6,519 stars               |2–5 days         |Early alternate after music audit  |
|Painted Valley |Exploration scene; Three/Rapier/Vite          |MIT/CC0; hosted audio excluded    |1,830 X likes             |2–4 days         |Scene foundation; non-GitHub source|
|Valley Ride    |Horse-riding journey; TS/Three r187/Vite      |MIT; documented CC0 assets        |3 stars; 168 X likes      |4–7 days         |Conditional: load size and mobile  |
|pmndrs Racing  |Racer; React/R3F/Cannon/Vite 2                |MIT; README CC0 asset policy      |2,226 stars               |5–10 days        |Later: backend/pause/input work    |
|Cuberun        |Two-button arcade; React alpha/R3F/CRA4       |MIT; fonts/background need audit  |347 stars; 2022 award     |5–10 days        |Later: old build and synced audio  |
|SYNTHBLAST     |Tank arcade; Three/Pixi/Vite                  |Apache-2.0; asset audit retained  |142 stars                 |3–7 days         |Conditional compact action         |
|Claude of Duty |Procedural FPS prototype; Three/Vite          |MIT LICENSE; ISC metadata mismatch|3,533 stars; 7,802 X likes|5–10 days        |Desktop prototype reserve          |
|Cayley         |Streamed-world flight simulator; JS/Three     |MIT code; external data terms     |10 stars; 298 X likes     |5–10 days        |Defer pending service/data plan    |
|Pillar Valley  |One-button arcade; Expo/WebGPU                |MIT; asset inventory incomplete   |774 stars                 |1–3 weeks        |Higher-effort comparison           |

Counts are snapshots on 26 November. GitHub stars measure developer interest; X likes/views measure attention. They are not review scores. Baron has substantive public player discussion, and Cuberun has an independently documented award. Those signals still do not establish current OGM compatibility. These earlier discoveries remain in the deck as alternatives; they no longer set the first-wave recommendation. Each profile below links its primary repository, license, media and available social evidence.

5. Original candidate profiles and evidence

5.1. Little City

Priority: optional city-sandbox import; estimate 2–4 engineer-days after the shared importer. Derek Yao’s block-stacking city sandbox is the closest match to the user’s reference: a hand-drawn island town, more than 80 building combinations, and inhabitants. The editable source is yaoderek/littlecity; yaoderek/littlecity.io is compiled output, and craftmygame/little-city is a different project. Its unusually named default branch is yaoderek/bloom-s-monkey-city-builder.

The source uses TypeScript, Three.js and Vite; documented setup requires Node 22.12+. Touch is documented. Gamepad control and genuine pause are not verified; Escape changes the camera view. The adaptation needs a controller-driven cursor/build interaction, preserved touch gestures, lifecycle integration and namespaced town persistence. Remove or replace the upstream analytics configuration before hosting. The actual repository license is MIT; final installation should still inventory included assets.

The November 24 creator post had 963 likes and 57,406 views in the November 26 public mirror snapshot, while the source repository had only 3 stars. That is useful discovery evidence, not proof of game polish.

Sources: Source · License · Play/demo · Actual media · Creator on X · Creator video.

5.2. Baron

Priority: optional small engineering pilot; estimate 1–3 days. DAI Studio’s cartoon flight game lets players build a plane, fly procedural landscapes, land, follow cross-country routes and skywrite. It offers scored objectives rather than only a rendering demonstration. Its static Vite output, documented pause menu, physical gamepad support and landscape phone controls make it a useful small lifecycle/control proving case.

The current README specifies Node 26+ and npm 11, so verify the available build runtime. Reuse its flight controls while handing pause/settings ownership to OGM; avoid two simultaneous pad readers or competing menus. Existing touch steering, throttle and optional tilt still need testing inside OGM’s frame. Older feedback about Ctrl+W throttle shortcuts should not be presented as current: the primary UI now uses number keys.

Actual code licensing is BSD-2-Clause. The repository had 16 stars; the November 15 Hacker News discussion had 234 points and 68 comments in the research snapshot, including positive flight-feel reports and control criticism. No verified recent X count was located.

Sources: Source · License · Play/demo · Actual media · Player discussion.

5.3. REGOLITH

Priority: optional exploration import; estimate 3–7 days. REGOLITH: The Silence at Anaxagoras is a lunar rover adventure with scanning, drilling, buried finds, relay repair and five story missions. It offers a substantially different input/save workload from Baron and Little City.

Its vanilla ES modules, vendored Three.js r160, procedural terrain/textures/sound and absence of a backend make it attractive. The README explicitly attributes generated assets to repository code; preserve the vendored Three.js notice. Source inspection found window.REGOLITH exposing application state and tick(dt), an existing pause system and a save module. These are useful adaptation seams, not an OGM adapter already installed.

Bundle the inline import map for CSP compatibility, bridge bootstrap/tick/audio/save/teardown, and complete controller coverage. Existing pad support covers driving and several actions but not drilling, interaction, solar controls and every recovery action. Phone controls exist. The 138-star project describes itself as unfinished and documents a rover-stuck edge case; include that in playtest selection.

Sources: Source · License · Play/demo · Actual media · Official video.

5.4. Oil Paint

Priority: visual foundation after game imports; estimate 2–4 days for integration, excluding new gameplay. Blendi’s scene lets a player walk through autumn woods or a snowy aurora ridge rendered with fixed oil-paint strokes. It has no objectives/progression and no sound. It should be reviewed as an exploration scene or a starting point for a new game.

The original source is public Git on Patch, not GitHub. A GitHub-only first importer would need to defer it or explicitly support importing Git history into an independent GitHub repository; do not describe that operation as an upstream GitHub fork. The inspected commit was 804c65fa3a6c6fcdc732ed1bde450fd140cfb4e9. Licensing is unusually clear: MIT code, CC0 included art/stills, and Apache-2.0 Rapier.

It uses Vite, Three.js 0.186.1 and Rapier 0.21.0. Fetch Git LFS assets, add touch navigation and a real pause gate. Its renderer owns materials/the frame and is not a drop-in filter. The creator’s post had 8,020 likes and 461,890 views; published performance claims used an RTX 4090.

Sources: Source · License · Play/demo · Actual media · Creator on X · Asset credits · Original Git repository · Creator video.

5.5. Server Survival

Priority: alternate early import after audio clearance; estimate 2–5 days. Build a miniature cloud, connect services and survive traffic spikes through campaign, survival and sandbox modes. This is a complete educational strategy game with responsive touch interactions, save/load, simulation speed controls and architecture sharing encoded in URLs.

The game uses native JavaScript modules, Three.js r128 and an HTML/Tailwind HUD, with no gameplay backend. It has existing pause controls and independent audio preferences. OGM work includes bundling CDN dependencies locally, removing inline script/handler reliance, making DOM bootstrap disposable, adapting pause/audio and designing controller navigation for building rather than just movement.

The repository’s MIT license and generated geometry are positive. Five bundled MP3 files had no separate provenance manifest in the inspected tree: confirm their rights or replace them before distributing the fork. This is why its review-deck status is conditional. Its 6,519 GitHub stars are the largest developer-attention signal in the original thirteen-game set, not an independently verified player review score. The official GIF may depict an older HUD.

Sources: Source · License · Play/demo · Actual media.

5.6. Painted Valley

Priority: scene foundation; estimate 2–4 days, excluding gameplay creation. Blendi’s painted meadow, river, tarn and village support exploration and lighting changes. Houses are not enterable, the village is unpopulated, and quests/combat/objectives are absent. Treat it as a world to extend, not a complete adventure.

The original Patch Git source was inspected at e523a37e6c86df433a960a46702b09776e73a0e2; Git LFS is required. As with Oil Paint, this needs a separate public-Git acquisition path if the first importer only forks GitHub repositories. Included code is MIT, included art/stills and footsteps CC0, and Rapier Apache-2.0. Five Sonniss ambient recordings heard in the hosted demo are deliberately excluded from the source; follow MISSING_ASSETS.md or use compatible replacements.

Existing gamepad support is useful, but touch and true pause need work. P toggles the paint finish, not pause. Its approximately 13 MB hosted download and author GPU measurements are not mobile acceptance results. The November 12 creator post had 1,830 likes and 73,577 views in the public snapshot.

Sources: Source · License · Play/demo · Actual media · Creator on X · Asset credits · Original Git repository · Missing hosted assets · Creator video.

5.7. Valley Ride

Priority: conditional scenic game; estimate 4–7 days. Prasenjit’s horse-riding experience has a 2.5 km mountain route, four checkpoints, a summit campfire and an end card. It therefore has a small complete journey rather than only an explorable scene. MIT code and a documented credits file covering CC0 assets are promising.

The TypeScript/Vite project uses Three.js r187 WebGPURenderer/TSL. Do not repeat the outdated README interpretation that it is WebGPU-only: the creator corrected this on November 12, and ?webgl=1 exists. Physical gamepad controls are documented, while touch is explicitly unsupported. Escape opens settings/releases the pointer; full simulation pausing was not independently verified.

Budget for its roughly 74 MB first download, touch controls, OGM pause/input/audio integration, and performance testing on target phones. Source-based packaging ease does not establish acceptable mobile performance. The repository had 3 stars; its X post had 168 likes and 12,634 views. Replies included a missing-checkpoint report and criticism of the slow final ascent, alongside the author’s explanations.

Sources: Source · License · Play/demo · Actual media · Creator on X · Asset credits · Creator video.

5.8. pmndrs Racing

Priority: later polished racer; estimate 5–10 days. A low-poly desert racer with vehicle physics, boost, minimap and finish-time UI gives useful genre variety. The source is React 18, React Three Fiber 8, Three.js r139, Cannon, Vite 2 and Zustand. Its 2,226 stars indicate established developer interest, while the last recorded GitHub push was February 2023.

The MIT source and README’s CC0 asset policy offer a strong starting point. However, account/leaderboard code embeds a Supabase endpoint and public anonymous configuration. Driving is client-side; remove those modules for an independent local-score edition or configure an owned service. Never reuse the upstream service merely because its public configuration is in source.

No complete coordinated pause action, pad controls or mobile steering were found in the inspected source. Integrate React mount/unmount, Cannon physics, frame updates, race time, sound and inputs as one lifecycle. Validate the old toolchain before modernization. The live demo returned HTTP 403 to the research environment, which does not prove the site is unavailable elsewhere.

Sources: Source · License · Play/demo · Actual media.

5.9. Cuberun

Priority: later compact arcade game; estimate 5–10 days. A tiny craft threads neon cubes while speed and synchronized music intensify. Two-direction keyboard controls and documented mobile buttons make the gameplay input surface small. Cuberun independently won Fun Side Project of the Year at the React Open Source Awards 2022; it had 347 GitHub stars at the snapshot.

Its tooling is the main cost: Create React App/react-scripts 4, a React 18 alpha, R3F 6 and Three.js r129. Establish a reproducible baseline before changing build tooling. No backend is required; highscores and preferences are local. The music, visual progression and frame loops need a shared pause gate—game-started/game-over flags are not a substitute.

MIT is present, and the author identifies the music as self-composed. Separate rights for the Road Rage/Commando fonts and galaxy background were not established. Verify or replace them. The independent award is a useful quality signal, but it is neither a current compatibility test nor an aggregate player rating.

Sources: Source · License · Play/demo · Actual media · Independent award.

5.10. SYNTHBLAST

Priority: conditional arcade action; estimate 3–7 days. SYNTHBLAST has a clear loop: drive geometric tanks, shoot enemies, collect ammunition and clear yellow pads to progress. The inspected source uses Three.js r185, a PixiJS 8 HUD and Vite 8, with keyboard and touch control code.

Root licensing is Apache-2.0, and the author’s three.js forum announcement describes both code and assets as open source. A separate music/font manifest was not verified, so retain a targeted asset audit. No operational gameplay backend was found; remove the unused example.com highscores stub rather than accidentally treating it as integration.

The game has an independent RAF driving two renderers and no dedicated pause implementation found. Add one freeze/teardown path, host audio settings, named actions, and an honest score/save capability. Move inline startup into a module for OGM CSP. The 142-star project has positive developer-showcase replies, not a review aggregate. Its media card is an official title/level scene, not a newly captured action playtest.

Sources: Source · License · Play/demo · Actual media · Author discussion.

5.11. Claude of Duty

Priority: high-attention prototype reserve; estimate 5–10 days before any ambitious mobile work. Matt Shumer’s procedural urban FPS generated its scene, enemies, weapons, physics and synthesized sound in code. It had 3,533 GitHub stars; the July creator post had 7,802 likes and roughly 5.08 million views in the public mirror snapshot. It is the strongest viral signal here, not evidence of the best finished game.

The source uses ES modules, Three.js r180, WebAudio and Vite. Its own README discusses performance problems; the original repository had two commits and a July 25 last push. A linked Genex demo is a community port, not author hosting, and documents an upstream pause/resume fix. Reproduce and fix that behavior in the fork rather than assuming the original is equivalent.

The actual LICENSE is MIT while package metadata says ISC; reconcile the discrepancy. Controller/touch aiming and phone performance are not established. Treat this as a desktop prototype until profiling and real OGM input/pause tests justify broader claims.

Sources: Source · License · Play/demo · Actual media · Creator on X · Creator video.

5.12. Cayley

Priority: defer until external services are resolved; estimate 5–10 days with a constrained data plan. Lionel Mora’s flight simulator documents nine aircraft, cockpit instruments, weather and streamed real-world terrain. It uses plain JavaScript, vendored Three.js r184 and AudioWorklet, with no essential build step. Gamepads/joysticks and a dedicated P pause action are documented; mobile remains a limitation.

Static packaging is straightforward, but imagery, elevation, map, weather and airport requests conflict with OGM’s current same-origin connection policy. Decide whether to remove features, package a bounded region, or provide an approved owned data path. A proxy by itself does not resolve provider terms or attribution.

MIT covers the code; external data retains provider conditions. The README identifies EOX imagery as CC BY 4.0, OSM/ODbL attribution, and the Open-Meteo free service as noncommercial. Verify current terms before a deployment decision. Aircraft fidelity and handbook-test claims are the author’s claims, not independent simulation certification. The repository had 10 stars; its X post had 298 likes and 19,050 views.

Sources: Source · License · Play/demo · Actual media · Creator on X · Creator video.

5.13. Pillar Valley

Priority: visual comparison, not a quick current-branch import; estimate 1–3 weeks. EvanBacon’s one-button game times jumps between pastel pillars, collects gems and tracks progress. Its simple interaction and published mobile history are attractive, and the repository had 774 stars. No app-store rating was researched.

The current branch is materially more complex than older Expo/Three descriptions suggest: Expo 55, React 19, React Native Web, Three.js r172 WebGPURenderer and a custom react-native-wgpu canvas. A WebGL fallback was not verified. The web audio path deliberately returns early, so audio should not be promised from the current export.

There are useful isPaused, RAF cleanup and browser focus hooks, plus persisted scores/currency/progress. First choose a known browser-working revision, then adapt or extract the native shell without losing gameplay. MIT exists and a dependency-license catalog is present, but that is not a complete separately checked asset manifest. This should not be used as evidence that every existing Three.js game is a small wrapper job.

Sources: Source · License · Play/demo · Actual media.

6. Architecture: reuse the host, make the source layout first-class

Source-audited baseline; not production acceptance

The OGM code inspection is pinned to 12245a540d5ac79893fc531d8be884b773d8260f. There is already a gm games register command for existing repositories and an operator gm publish command for registered games whose tickets are not OGM build jobs. Registration creates the game/daemon association; publishing builds a chosen commit and uploads the same static artifact shape used by normal games. However, both currently assume a monorepo game folder. A generic GitHub importer was not found in the inspected CLI tree. Registration implementation · Registration CLI · Publish CLI.

|Concern       |Existing reusable capability                                            |Import-specific responsibility                                              |
|--------------|------------------------------------------------------------------------|----------------------------------------------------------------------------|
|Catalog/play  |Normal game record, media, game frame and published builds              |Fork provenance, chosen revision, install status and tested artifact        |
|Chat/features |Game jobs, branch association, per-repo issue dispatch and daemon lookup|Register the fork, configure whole-repo scope and preserve game/job identity|
|Runtime       |Validated host bridge and SDK lifecycle                                 |Adapt the original engine, without replacing it unnecessarily               |
|Controls      |Host touch overlay/gamepad polling and named action frames              |Translate actions, resolve native readers, support actual game interactions |
|Editor        |Preview, conversation, design transactions and optional visual hooks    |Honest initial empty state; progressively add real controls in fork source  |
|Builds        |Artifact/schema/CSP checks, preview and publication                     |Independent pinned toolchain, correct source root and reproducible packaging|
|Saves/settings|Existing bridge, storage UI, migration and player settings              |Real serialize/restore/audio integration; accurate capability declarations  |

Standalone source roots are the central missing capability

Introduce an explicit distinction between an instance-folder game and a standalone-repository game. These are proposed model concepts, not existing API fields. Game identity/slug must be independent of source-directory naming. A single canonical source resolver should represent the repository root unambiguously and supply safe path joins throughout the pipeline.

Changing registration alone is insufficient. The inspected blockers are concrete:

|Current location                                            |Current assumption or failure                                                   |Required change                                                        |
|------------------------------------------------------------|--------------------------------------------------------------------------------|-----------------------------------------------------------------------|
|`services/api/src/games/register.ts` and registration CLI   |Only `games/<slug>` is valid; slug is derived from that path                    |Accept explicit standalone layout and separate slug                    |
|`packages/gm-cli/src/commands/publish/index.ts`             |Falsy repo path is rejected; pnpm install/build and Vite-style flags are assumed|Root-aware build location plus reviewed per-fork build recipe          |
|`services/commit/src/paths.ts`                              |`normalizeGamePath` permits only `games/<slug>`                                 |Root-scope representation with existing traversal/protected-file checks|
|Commit boundary checker and folder rule                     |PR ownership requires a folder prefix; empty root becomes an unusable prefix    |Associate root changes with the one registered standalone game         |
|`services/commit/src/ops/fold-design.ts` and boundary inputs|Design paths, tree scans and asset locks receive folder prefixes                |Use canonical source-root joins                                        |
|Preview/scenery/scenes/editor-library and review readers    |Several treat missing/falsy paths as unavailable                                |Distinguish legitimate root from missing registration                  |
|Managed daemon generation                                   |Sparse checkout and prompt restrict writes to `games/<slug>`                    |Select whole-repository profile for standalone forks                   |

These changes preserve boundaries: an imported agent can edit its own fork’s original source, without giving instance-folder agents authority over unrelated games. Do not solve this with dummy nested packages, symlinks to open-games, or a global removal of write guards. Path normalization · PR ownership · Folder rule · Design folding · Boundary inputs · Preview relay.

There are preserved standalone seams: gameDir() recognizes root gm.manifest.json; readGameFolder() supports a root repository but calls that legacy read-only mode; renderDaemonFiles({}) retains a full-repository clone/prompt. The task is compatibility work across established boundaries. Root discovery · Legacy root reader · Daemon profiles.

Reuse per-repository Aiur and chat routing

Job intake obtains the GitHub repository from the game row and files feature tickets there. Daemon lookup resolves the game’s own daemon, previous slug, or one unambiguous registered daemon for that repository. Chat job routing uses the same association. Registered daemons are reused as configured; the fleet does not automatically rewrite or resize them. There is no demonstrated need for another chat gateway. Job intake · Daemon lookup · Chat routing · Fleet behavior.

The import must ensure that “add a new enemy” creates work against the fork’s original source, that its branch yields the corresponding preview, and that publishing uses that tested revision. Initial absence of visual controls must not imply read-only source. Later custom editor work belongs in the same repository and review loop.

Preserve independent dependencies

OGM’s core-release tooling already describes immutable SDK packages, including standalone repositories. Source imports such as @gm/sdk can use pinned aliases to @open-game-maker/sdk@0.0.0-core.<sha12>, recorded in vendor/core-packages.json. This avoids dependencies on a local open-games checkout. Feature admission also checks lightweight vendor/core.json metadata for a compatible core/skill revision. Verify actual registry availability at implementation time; this spike checked tooling, not a particular published version. Core releases · Feature skill check.

Keep the upstream package manager and lockfile when practical. Add a small OGM build entry, SDK dependency and metadata layer in the fork. An npm, static-JS or Expo source should not be rewritten into the instance monorepo merely because the current operator publisher assumes pnpm.

Supported-game catalog and packaged shims — approved product direction

The shared catalog recommends games whose OGM integrations have been completed and verified. It is distinct from an instance’s installed Games list: selecting a shared entry installs a separately owned, editable fork into that instance. Keep the custom-repository import path for hosts who want a game that is not yet supported. All 38 cards in this research remain researched candidates until their real integrations pass; do not relabel them supported because their source looks compatible.

Each supported catalog entry should include authentic screenshots or clips, description and genre, the original repository and credits, code/asset license references, supported upstream revisions, the shim package/version, compatible OGM SDK version, build recipe, last verification date, and verified capabilities. Surface controller, touch, pause, saves, multiplayer and editor capabilities accurately. A default preview/chat editor and a full visual level editor are different capabilities.

Package the integration work when support is added. The versioned game-specific shim contains the reusable lifecycle, input, audio, viewport and save bindings; manifest defaults; build integration; required source patches or installation steps; and focused compatibility checks. A package dependency alone may be insufficient: patches to original game code must be explicit, reproducible and tied to the supported upstream versions. Keep reusable code and metadata in OGM’s support-package distribution; the complete game, its assets and host-specific changes remain in each standalone fork. Do not move full games into open-games to distribute their shims.

The installation path is: select catalog entry → fork the original source → install/apply its pinned shim and recipe → build and verify → add the game to the instance’s Games list. Preserve the original source layout, independent build and agent access to original files. The resulting fork can be extended through OGM chat and can gain editor mode or custom controls later. Ordinary gameplay retains the existing no-AI/API-spend constraint.

“Supported” applies to a tested upstream revision + shim release + OGM version combination and its advertised devices/capabilities. Record that combination in the installation. Stage upstream and shim updates, test them, and preserve rollback. Support for one version does not assert compatibility with every future upstream commit or with arbitrary later changes inside a host’s fork.

Reusable compatibility fixes should become new shim releases after verification. Existing installations stay pinned until their host chooses to update. A host’s new levels, characters, mechanics, private assets and editor customizations remain in that host’s fork. Do not automatically publish those into the shared package or push them upstream. A reusable editor integration may later become an optional capability of the shared shim when deliberately promoted and tested.

Start with a small versioned catalog data file and the existing package/release infrastructure. Choose the actual package format and repository location during implementation; no new marketplace service is required. Shared engine utilities can be extracted after multiple game integrations demonstrate genuine reuse.

Acceptance: complete one integration, release its shim and catalog entry, then install that supported entry on a second clean OGM instance without writing new adapter code. Both instances must retain separate editable forks. Verify install/build, real play and lifecycle behavior, advertised controls/devices, a chat edit to original source, draft preview and publishing. Also demonstrate a shim update that preserves local game changes, or clearly reports a conflict while keeping the last working version available. This repeat-installation proof is part of completing game support.

7. The runtime adapter and initial editor

Actual contract

The existing GameModule<D,S> contains manifest, designSchema, controls and an asynchronous mount(host, design, save?). The returned GameInstance requires pause, resume, dispose, applyDesign, serialize, restore and net hooks. Picking, projection, placement, selection, camera and migration hooks are optional. boot() performs the host handshake and calls designSchema.parse({}), so default design data must be valid. These are code-verified interfaces; no new postMessage protocol is proposed. Game contract · SDK boot.

A minimum imported build supplies index.html, manifest.json, design/design.json and credits.json, with valid schemas and relative asset paths. The existing Vite helper emits this shape where suitable. A different engine can produce the same artifact contract without being rewritten into Phaser or Three. Advertise only implemented capabilities; satisfying a net type does not make an imported game multiplayer. Build validation · Artifact requirements · Build helper.

Initial default editor

The current GameScreen hides its “Game editor” tools if the published manifest has no palette items/categories, tools or controls. A test explicitly verifies that no fallback tools appear for a game without an editor. The surrounding preview/chat workspace is reusable. GameScreen · Empty-editor test.

Add an explicit imported-game editor shell showing the preview, chat and a clear empty state such as “Describe a change to this game. Visual tools can be added as the game is extended.” Do not invent selectable objects or add dummy palette entries. The agent may immediately change code through chat. Later expose specific parameters with real design paths, then add picking/projection/placement only when connected to the engine’s actual data model.

Input and pause need real game integration

The host sends named actions through input.frame; SDK HostApi exposes action subscriptions, viewport and settings subscriptions, haptics and other existing services. Prefer direct engine input APIs. Synthetic keyboard events are a compatibility technique for some games, not a universal controller layer: event targets, held states, edge-triggered actions, trusted events, text input and analog aiming differ. Release inputs on pause, disconnect, blur and disposal; prevent duplicate native/host pad readers. Input transport · Input merger.

A concrete mapping caveat: host defaults assign declared button actions in order to A, X, B, Y, LB, RB, and sticks to left/right sticks. The lower-level frame accepts overrides, but the inspected high-level frame has no dedicated per-game mapping field. The importer should deliberately expose/route explicit mappings through a supported contract and verify expected A/B behavior. A manifest alone does not establish controller usability. Gamepad mapping.

SDK pause clears pending input, pauses its fixed clock and calls instance.pause(). It cannot automatically stop an external engine’s RAF, wall-clock deadlines, intervals, workers, network simulation or independent audio graph. Gate or offset all relevant clocks, suspend intended audio, and avoid accumulated time/input on resume. Preserve a real user gesture for audio unlock; keep player mute preference separate from temporary pause. The host’s menu and background/app-switch pause paths can then work as designed. SDK lifecycle · Runtime dispatch · Away pause.

Use viewport updates to preserve logical aspect ratio, safe areas and portrait/landscape behavior. Choose OGM touch controls or explicitly retain the game’s controls; do not render both. Save support must represent meaningful game state. Map localStorage progress to OGM persistence only when restore/migration semantics are understood; otherwise avoid promising OGM save slots. The existing pause and save conformance checks are reusable, but meaningless empty snapshots can conceal a running external simulation. Pause check · Save round-trip.

8. Shared cloud saves and browser-runtime foundations

What OGM already has

At inspected core commit 12245a540d5ac79893fc531d8be884b773d8260f, OGM uses SQLite through better-sqlite3 and Drizzle, with WAL, foreign keys and a busy timeout. The API owns database access. This is a source audit, not a test of Kevin’s running host. OGM already has authenticated save routes and revision storage; extend and prove them for imported games rather than creating a per-game persistence fleet. Database · Save schema · Save routes.

|Existing code        |Proven capability or limit                                                                                                                                      |Import implication                                                                              |
|---------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
|Save schema/store    |User/game/slot identity; auto plus three numbered slots; gzip payload, digest, build/release/branch/schema and device metadata; normally five retained revisions|Reuse identity, revisions and compatibility records; avoid an unrelated cloud-save service      |
|Write store and lease|Transactional version checks, idempotency and stale-write detection; 30-second play lease with heartbeat                                                        |Preserve conflict protection instead of silent last-write-wins                                  |
|SDK save machine     |Dirty tracking; pause/checkpoint/hidden/interval saves; safe-state fallback                                                                                     |Connect to actual upstream safe-save boundaries                                                 |
|SDK SaveClient/outbox|IndexedDB queue, retry/backoff, local conflict copies and sync status                                                                                           |Useful implementation exists, but the inspected app does not wire this client into its save path|
|Current app save path|PlatformHud calls direct API write after obtaining a lease; failures show a toast                                                                               |Durable offline upload is a gap, not an already proven production feature                       |
|Startup restoration  |Reads autosave before play and disables writes when restore fails                                                                                               |Preserve unreadable saves rather than overwrite them                                            |

Store · Lease · Save machine · Offline client · Outbox · Shell wiring · Startup restore.

The reusable save contract

The adapter should preserve the upstream format: a state export, opaque savefile or manifest of named files. Do not convert every game’s world simulation into OGM relational tables. Three families cover most candidates:

|Upstream persistence   |Shared adapter approach                                                                                           |
|-----------------------|------------------------------------------------------------------------------------------------------------------|
|JS state/export API    |Call native export/import and wrap compatibility metadata                                                         |
|localStorage/IndexedDB |Prefer native export; otherwise allowlist game keys/records, namespace by account and fork, restore before startup|
|WASM virtual filesystem|Snapshot declared save/config paths only, at a completed native save; restore files before starting the engine    |

Emscripten MEMFS is temporary memory; IDBFS uses IndexedDB through syncfs() or an automatic-persistence mount. Neither provides account-based cloud sync. Do not snapshot licensed game-data archives, executables or caches with the save. Multi-file game state must be captured consistently, using a native save-complete hook or safe checkpoint. Filesystem API.

The concrete missing work is:

1. Large transfers. API uploads are capped at 512 KiB compressed. The iframe port JSON-stringifies messages and limits string length to 262,144 characters despite a comment suggesting saves bypass that limit. Introduce a bounded binary/chunked transfer with digest checks; do not base64 large worlds into the current bridge. Bridge contract · Actual port.
2. Asynchronous snapshots. Current serialize/restore hooks are synchronous. Native save generation and filesystem flush may be async. Add a supported async capability or maintain a complete last-safe snapshot; hydrate before the game reads files. Save periodically and at checkpoints rather than trusting browser close.
3. Durable offline sync. Wire the existing queue through the app. Distinguish saved locally from synced; retry on reconnect/relaunch. Partition outboxes by signed-in user and game so an old user’s data cannot upload under a new login.
4. Compatibility. Record upstream commit/version, engine/game/mod set, shim/save-format version and schema alongside existing build/branch metadata. Separate forks have separate game IDs. Incompatible experimental branches need an explicit namespace or copy/migrate flow; branch metadata alone does not isolate slot heads.
5. Quotas and conflicts. Limit compressed/decompressed size, file count, paths and total user/game/instance storage. Keep local and cloud conflict copies, support intentional device takeover and export/import, and preserve a rollback revision. Never merge arbitrary binary savefiles.

Keep small payloads in the existing SQLite BLOB store. If measured world sizes make that inefficient, retain transactional metadata/digests in SQLite and place payload files on the same host. That can avoid another DB or object-store service. Treat payload writes atomically and test orphan cleanup and restore before adding dependencies.

Browser support and shared runtime

The inspected CSP allows WASM compilation and local workers. It serves COOP but not COEP; threaded exports need a correct isolation policy across the outer app, iframe and resources. A header added only to the game frame is not proof that SharedArrayBuffer works. Single-thread and threaded distributions may need distinct recipes. Validate JSPI, WASM-GC, WASM64, WebGL/WebGPU and extension requirements per game rather than assuming all WASM is interchangeable. Game headers · Emscripten pthreads.

Add an engine-neutral WASM adapter family for runtime boot/shutdown, workers, focus, pause/audio, file hydration/export and first-frame readiness. Runtime sharing does not erase game-specific input/menu semantics. Thread pools, large downloads, background tabs and memory must be measured on actual targets. A native Android release does not establish Safari/iPhone support.

When the existing database can replace a backend

Good consolidation targets are optional profiles, preferences, save slots, high scores, achievements and simple leaderboards. Replace those calls with existing OGM APIs where appropriate. Game credentials and DB access stay in the trusted host; the sandbox receives narrow authenticated capabilities, not connection strings or broad tokens.

A turn engine, persistent world, opponent simulation, hidden-information authority or native multiplayer protocol is a different responsibility. OpenFront multiplayer, a shared Luanti world, OpenRA matches and MMO servers still need game simulation even if their storage is moved to SQLite. Browser clients also cannot directly use ordinary native TCP sockets; a protocol bridge or WebSocket adaptation may remain. Emscripten networking.

For a compelling exception, document the minimum server functions, remove optional analytics/auth duplication, compare retaining that service with replacing its persistence, and estimate ongoing operations. Do not build a universal backend fleet before the client-only catalog works. Remote desktop/VNC streaming is outside the default route because it replaces lightweight client execution with continuous hosted computation.

9. Archived proposed implementation tickets and acceptance — DO NOT FILE OR DISPATCH

The following are historical possible ticket scopes and acceptance concepts, not authorized work. None were filed by this research. The former suggestion to start with curated browser-native sources and reproducible browser/WASM ports is superseded by the research-only hold. Patch-hosted scenes would require an explicit public-Git acquisition path if ever approved.

|Ticket                                               |Scope                                                                                                                                      |Acceptance evidence                                                                                                                                                                        |
|-----------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|IMP-01 — Standalone source layout                    |Introduce canonical source identity/root; extend registration, path joins, PR boundaries, design, preview and publish readers              |A root-level game registers; a root gameplay edit is allowed in its own fork; unrelated repositories and protected paths remain denied; existing folder games still work                   |
|IMP-02 — Fork and import recipe                      |Actual GitHub fork, upstream/source pin, fork head, engine/build recipe, license evidence, capabilities and import status                  |Fork retains original history/layout, independently installs/builds, and OGM records exact source/adapter/artifact revisions; nothing is added to open-games                               |
|IMP-03 — Reusable adapter scaffold and empty editor  |Existing SDK boot/manifest/artifact packaging; explicit input mapping; lifecycle capability declarations; initial preview/chat editor state|Host gets ready/first frame, controls and true pause; no duplicate menus; no fake visual controls; source remains editable                                                                 |
|IMP-04 — Fork-specific agent/build loop              |Reuse per-repo Aiur, route game jobs and branch previews; preserve own package manager/lockfile; isolated build recipe                     |A chat request changes original root source, opens its own review/branch, and displays the matching OGM draft without touching upstream                                                    |
|IMP-05 — Install/update/rollback proof               |Candidate gates, credits, last-good artifact, pinned updates, failure reporting                                                            |Successful build appears in Games; failed update leaves last-good playable version; rollback restores an earlier verified build                                                            |
|IMP-06 — First game integrations                     |OpenTTD plus SuperTux or Freedoom; shapez as the browser-native strategy option                                                            |Each has candidate-specific input, audio, pause, sizing, rights and save evidence rather than only a successful bundle                                                                     |
|IMP-07 — Supported catalog and reusable shim releases|Curated catalog data and discovery UI; versioned game-specific shim plus install recipe; compatibility/capability metadata and update pins |A verified entry installs on a second clean OGM instance without new adapter code; each instance keeps its own editable fork; shared updates preserve or explicitly reconcile local changes|

The expanded scope needs these additional slices, staged behind clear proofs:

|Ticket                                      |Scope                                                                                                                        |Acceptance evidence                                                                                                                                           |
|--------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
|IMP-08 — Browser/WASM runtime               |Reproducible compiler recipes, artifact packaging, workers, correct app/frame isolation, runtime feature checks and lifecycle|Chosen official/community port starts and stops under real OGM CSP; unsupported browsers receive an honest message; no orphan workers/audio after exit        |
|IMP-09 — Imported-game cloud saves          |Binary/file transfer, async export/hydration, durable outbox wiring, compatibility, quotas and conflict handling             |Meaningful state moves between devices; offline save survives close/reopen; conflict preserves both copies; largest supported save and upgrade/rollback tested|
|IMP-10 — Civilization viability             |Bounded Unciv TeaVM and local-worker Freeciv source/build/play tests                                                         |Repeatable solo session, meaningful turns, save/reload and required features; no VNC or game server accidentally introduced                                   |
|IMP-11 — Luanti family viability and adapter|1–2 day engine/game spike, then separately approved 2–4 week desktop family adapter                                          |One selected survival pack plays and saves; memory/features reported; second pack reuses runtime with explicit compatibility tests; phone/MP remain gated     |
|IMP-12 — Private commercial-data loading    |User-local asset import, version detection, isolation, cache deletion and license provenance                                 |RCT2/other lawful owner data never enters public shim/artifact/source or another account; save files remain separately exportable                             |
|IMP-13 — Second-host catalog proof          |Concrete execution of IMP-07’s reuse gate with a clean instance and independent fork                                         |No bespoke adapter edits; play/save/chat-edit/publish work; upstream/shim update preserves local changes or cleanly reports conflict                          |
|IMP-14 — Server exception research          |Only for a selected high-value game; inventory authority/protocol/storage and minimal ops                                    |Explicit client/server boundary, operating-cost estimate and approval before deployment; no claim a DB swap alone removes simulation                          |

For estimates, IMP-01 and root/agent plumbing represent approximately 2–4 days; fork recipes/build/install orchestration approximately 2–4 days; end-to-end proof approximately 1–2 days. Their combined 5–10 day shared range is a narrow original foundation estimate counted once, not a budget for the expanded program. IMP-06 uses the per-game ranges after relevant foundations; full phone/controller parity is not included. IMP-07 is newly added scope and needs an incremental estimate; plan its package/metadata contract alongside the first adapters so completed support can be reused immediately. Cross-cutting root support and acceptance checks should land as cohesive slices; they are not independent promises that every optional subsystem is completed instantly.

The decisive end-to-end demonstration is: select upstream → create independent fork → register/build → play through OGM → ask chat for a root-source gameplay change → inspect draft preview → publish → roll back. Also show that the fork runs outside OGM and builds without a sibling checkout. That proves extensibility and self-containment, not merely embedding.

Shared-save acceptance additionally covers account/fork isolation, local-outbox account changes, stale writes, incompatible schemas, quota exhaustion and malformed file bundles.

For each chosen game, exercise first-frame readiness, gameplay and menu actions, held-key release, controller reconnect, host pause, background/resume, audio unlock/mute, mobile orientation/safe areas, disposal/remount and optional save round-trip. Use the actual production CSP. If saves, multiplayer or mobile are absent, the displayed capability state must say so. Reuse existing conformance checks and add focused candidate tests only for remaining risks.

10. Packaging, rights and isolation

An import recipe should record upstream URL/path/commit; fork URL/head; independent slug and source layout; dependency lock/build/output; compatible SDK revision; input mappings; lifecycle/save support; credits/license evidence; adapter revision; and verification results. These are proposed recipe concepts. Start with a small reviewed data format and two real imports before extracting a universal engine abstraction.

Preserve upstream notices and history, keep OGM-specific changes easy to identify, and stage upstream updates on a branch. Never silently advance an installed game with upstream main. General fixes may later be offered upstream; game-specific OGM hooks can remain in the fork. Maintain the last verified artifact and source revision for rollback.

The games host already separates game origin from app origin, validates bridge messages, and applies sandbox/CSP rules. Current policy blocks remote scripts/assets, inline scripts and nested frames, and limits connections to the games origin. WASM compilation is allowed, but threaded engine exports or remote services may need additional requirements. Package dependencies locally and verify them under the real policy. Frame isolation · Response headers · CSP checks.

The inspected operator publisher uses a detached worktree, spawns package-manager/build processes and removes OGM_INTERNAL_TOKEN from the child environment. It does not itself establish an OS sandbox. Automatically building newly flagged code requires an isolated worker without host secrets, broad writable mounts or unrestricted outputs. Published games share a games origin, which isolates them from the app but is not strong per-game storage isolation. Those boundaries matter when moving from curated games to arbitrary submissions. Publisher execution.

A repository code license is not a complete asset clearance. Check music, fonts, textures, models, logos, downloaded data and hosted-demo-only content separately. Keep provenance in the fork and credits artifact. Rights-sensitive observations here are source findings for engineering selection, not a complete legal audit. Recheck license/service terms at the selected commit and before public distribution.

11. RestoreBound precedent and its limit

The public its-everdred/finn repository was inspected at b5fa04939db88154292417a8fa1619267083a9e8. RestoreBound is an original static Kaboom game: a 320 × 240 logical canvas, Kaboom 3000.1.17 loaded from unpkg, inline bootstrap scripts, touch-to-keyboard synthesis, localStorage scene/state saves with migration, and an independent Web Audio scheduler. These are specific seams an import must adapt. Its public “pause menu” behavior is not proof of the OGM host lifecycle. Original README · Bootstrap/input · Gameplay/save · Audio.

OGM core contains a test saying the family’s real RestoreBound replaced its former showcase placeholder. That confirms the intended real-game precedent. The open-games repository could not be inspected anonymously, so the installed adapter, exact patches and current deployment were not verified. Obtain that adapter before claiming it can be generalized; reuse useful lessons while implementing the user’s now-required independent-fork architecture. RestoreBound catalog test.

The finn tree had no root LICENSE/COPYING/NOTICE file. Its MIT references identify Kaboom, not automatically every game file/drawing. The user owns this source; third-party imports still need their own code/asset evidence. No source was copied, forked or installed during this spike.

12. Additional recognizable pillars, exclusions and reserves

Additional major-game comparisons

These are comparison-only additions outside the 38-card media deck. They remain visible because recognizability matters, even when rights, native clients or servers make them poor immediate imports.

|Project                                               |Browser/infrastructure finding                                                                                                                                                             |Rights and recommended treatment                                                                                                                                                                                                                                                                                                                                                         |
|------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**Tuxemon** — monster-catching RPG; 1,190 stars       |Official Python desktop/experimental Android installation; no supported browser build verified. Solo does not inherently need a server.                                                    |GPL3+ code and original CC BY-SA art make a cleaner content direction. Defer as a browser-port project. [Repo](https://github.com/Tuxemon/Tuxemon), [installs](https://github.com/Tuxemon/Tuxemon/blob/development/docs/installation.md), [official art/license](https://tuxemon.org/).                                                                                                  |
|**PokéRogue** — Pokémon roguelite; 5,951 stars        |Browser-native TS/Phaser, with separate rogueserver API. Local development is documented; a complete unchanged offline session was not proven.                                             |AGPL code does not clear Pokémon content. Docs/licensable assets use CC BY-NC-SA with exceptions and unlisted assets lack licensing information. Rights-dependent, not a clean ready catalog entry. [Code](https://github.com/pagefaultgames/pokerogue), [assets](https://github.com/pagefaultgames/pokerogue-assets), [backend](https://github.com/pagefaultgames/rogueserver).         |
|**VCMI** — Heroes III; 6,045 stars                    |Native C++ engine with concrete community Emscripten/HTML5 branch. Verify local solo in the selected port before asserting hosted-server needs; multiple weeks, not a thin two-day wrapper.|GPL2+ engine/CC BY-SA original assets; requires owned Heroes III Data/Maps/Mp3. Strong conditional follow-up. [Official](https://github.com/vcmi/vcmi), [data requirements](https://github.com/vcmi/vcmi/blob/develop/docs/players/Installation_Windows.md), [WASM source](https://github.com/caiiiycuk/vcmi-wasm/blob/vcmi-wasm-1.7.3/CMakeLists.txt).                                  |
|**Julius / Augustus** — Caesar III; Julius 3,459 stars|Julius has compatible-browser support and Emscripten instructions; static solo, no game DB needed. Reproduce current tooling. Augustus’ web status needs separate proof.                   |AGPL engine; original Caesar III files required. Julius preserves original-compatible saves; Augustus saves cannot load back into Julius. Conditional 5–10 day adapter after shared runtime/data-loader work. [Julius](https://github.com/bvschaik/julius), [web build](https://github.com/bvschaik/julius/wiki/Building-for-Emscripten), [Augustus](https://github.com/Keriew/augustus).|
|**FreeSO** — The Sims Online; 991 stars               |Native MonoGame client plus real MMO services, DB, registration and distribution. Official server closed December 9, 2024; Archive is still described as developing.                       |TSO content rights remain separate. Native sandbox is not a ready browser game. Defer high-infrastructure/native-client work. [Status](https://freeso.org/download/), [about](https://freeso.org/about/), [server responsibilities](https://github.com/riperiperi/FreeSO/blob/master/Documentation/Server%20Configuration.md).                                                           |
|**TrinityCore** — WoW server; 10,904 stars            |C++ server framework, not a browser game; world/auth services plus MySQL auth/character/world data. A proprietary client is separate.                                                      |GPL2 server rights do not license WoW assets/client. SQLite replacement would not remove world authority or client-port work. Poor fit now. [Repo](https://github.com/TrinityCore/TrinityCore), [DB](https://trinitycore.info/install/Database-Installation), [server](https://trinitycore.info/install/Server-Setup).                                                                   |
|**OpenBW** — StarCraft tooling; 272 stars             |Native CMake/SDL2/BWAPI tooling; a browser replay viewer is not proof of a complete campaign. Linked guide reports no built-in AI opponent and limited native 1v1 transport.               |Needs original MPQs. Root engine license was not resolved in this bounded check. Defer full-game/browser/AI/rights investigation. [Engine](https://github.com/OpenBW/openbw), [build and limitations](https://github.com/OpenBW/bwapi).                                                                                                                                                  |

Original discovery exclusions

Do not use visually appealing public source as a substitute for permission to redistribute. The following were deliberately excluded from the 13-card import shortlist or kept outside the first implementation:

|Project         |Reason and source                                                                                                                                                                                                      |
|----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Lost Cathedral  |Actual source-available license prohibits hosting/redistribution and asset reuse without written permission; public code is not permissively licensed. [Repository](https://github.com/Rabneba/lost-cathedral)         |
|Saltline mirror |Explicitly unofficial mirror of an original Claude artifact; no license found. Do not treat the mirror as approved source. [Repository](https://github.com/realcodebear/saltline-fable-5.2)                            |
|Expo Crossy Road|README frames it as educational and invokes fair use of copyrighted Crossy Road content; MIT source does not clear the whole game/assets. [README](https://github.com/EvanBacon/Expo-Crossy-Road/blob/master/README.md)|
|The Cube        |No root license found; package ISC metadata alone did not establish whole-game clearance. [Repository](https://github.com/bsehovac/the-cube)                                                                           |
|The Aviator     |Codrops terms restrict as-is republication/redistribution. [README](https://github.com/yakudoo/TheAviator/blob/master/README.md)                                                                                       |
|Konterball      |Paid fonts, deprecated WebVR and Deepstream multiplayer backend increase rights and adaptation work despite MIT frontend. [README](https://github.com/madebywild/konterball/blob/master/README.md)                     |

Useful older reserves are HexGL (MIT with separate audio terms; old Three r53 and hiatus), Astray (Unlicense game, legacy Three/Box2D/jQuery notices and texture provenance to check), and pengfeiw’s Rubik Cube (MIT, procedural cubes, pointer/touch puzzle). They remain optional older browser reserves. Native-only games, commercial-data requirements, essential multiplayer servers and experimental browser exports are now explicitly compared above, with their extra work separated from the minimal import path.

13. Methodology, evidence quality and handoff limits

Research combined public repository/API metadata, actual license text where available, READMEs, selected entry/input/pause/audio/save/build files, original-host pages, creator announcements, and public discussions. Recent discovery included public X search and FxTwitter snapshots of original post URLs. It was not an authenticated or comprehensive X scrape. Missing X evidence means not found in this pass, not that a project has never been discussed. Counts can change or differ between crawls.

The 38-card research set mixes established games and reimplementation engines, community ports, recent 2026 experiments, older browser games, and clearly identified exploration foundations. Additional comparison-only pillars are not included in the card count. “Recent” does not mean a recent commit guarantees active maintenance. A GitHub push timestamp is not necessarily the date of substantive gameplay changes. Stars, views, likes, remixes, awards and individual comments are distinct signals; the established-game update includes separately attributed store/itch player ratings, never inferred from stars.

Media comes from original repository screenshots/GIFs, creator videos, or explicitly attributed source material. It is not AI-generated. Oil Paint/Painted Valley stills were retrieved through Git LFS and their CC0 notes checked; source commits are recorded above. REGOLITH’s official video uses deterministic game ticks and reconstructed sound parameters according to its README. SYNTHBLAST’s image is a title/level scene. Some official images may reflect earlier versions.

No complete game was built, fully played through, or imported into OGM in this research. HTTP 200 confirms a page response, not functional gameplay; HTTP 403 in this environment does not establish a global outage. An attempted SYNTHBLAST capture encountered disabled WebGL in the research browser. Controller, pause and performance conclusions are qualified as code/document observations unless explicitly verified. The architecture is code-inspected at the pinned OGM commit; source-based effort estimates remain hypotheses to test with the first actual fork.

Current status (supersedes the original next implementation action): retain the research and investigate original gameplay and integration families without starting implementation. The former suggested pilots, shared foundations, save work and second-host proof are unapproved future options. No forks, installations, adapters, catalog entries, tickets or deployments are authorized. A supported game would eventually need a verified real lifecycle and source-editing loop, a released reusable shim/catalog entry and a second-instance install proof, if Kevin later authorizes that work.

Appendix: commit-pinned OGM and RestoreBound references

The named links throughout the architecture resolve to the files below. All OGM references use the inspected commit rather than floating main. Candidate links above point to the original repositories/current source branches; capture each selected upstream commit before implementation.