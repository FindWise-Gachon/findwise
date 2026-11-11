# FindWise

**[English](README.md) | [한국어](README.ko.md)**

**A search decision-support system combining missing-person location probability prediction with AI-assisted field information integration.**

FindWise helps users decide **where to search first** and **how to revise a search plan when new field reports arrive**. The project aims to generate location probability maps from the last known position, elapsed time, and terrain, then update those maps using human-reviewed field information.

## Motivation

Initial information is incomplete, while unsuccessful searches, clues, and hazards continue to emerge during an operation. FindWise brings initial predictions and field information into one map to reduce the effort needed to organize information for decisions.

It supports human judgment rather than automatically declaring a person found or a case solved. It is also intended for police administration education and exercises, with room to connect additional analysis capabilities later.

## Project goals

- **Location prediction:** compare distance, terrain, and simplified behavioral models using a last known position or candidate area, elapsed time, and terrain.
- **Map visualization:** display probability heatmaps and search status alongside satellite imagery, contours, and other map layers.
- **Field information integration:** structure Korean text reports with AI; apply only information reviewed, corrected, and approved by a person.
- **Reasoning and history:** preserve original reports, review decisions, and map changes so users can inspect why recommendations changed.
- **Evaluation and education:** assess model performance, report extraction quality, update correctness, and usability through documented experiments and educational scenarios.

## Planned workflow

```text
Position, time, and terrain input
  → Initial probability map
  → Field report input and AI extraction
  → Human review, correction, and approval
  → Updated map and search priorities
  → Next search decision informed by the recorded history
```

## Design principles

**Extensibility:** separate configuration and functionality so regions, map/data providers, prediction models, and AI providers can change without rewriting the shared interface and workflow. Add modules as needed without prematurely splitting the project into many services or repositories.

**Intuitive interaction:** distinguish base-map selection from independent overlay toggles. Make report review states and the reasons for map changes visible. Organize the interface around understanding results and deciding what to do next.

## Repository structure

```text
frontend/    Web interface, maps, and layer controls
backend/     Terrain preparation CLI and future analysis and report APIs
data/        Local data, public samples, and provenance
docs/        Development setup
.github/     Pull request checks
```

Keep the top-level structure small. Split code within frontend and backend when actual implementation needs it.

## Status and getting started

The work region selector switches between Yosemite and Bukhansan. Both regions display a base map and satellite imagery with independent contours and hillshade. Yosemite uses 6 m cells in a 6 × 6 km development area; Bukhansan uses 10 m cells in a 9.8 × 15.84 km development area. You can show the boundary, inspect visible grid lines at zoom 16 or higher, and download the grid definition as JSON from Region Info. In Last Known Point, select and confirm the last known point (LKP), then choose **Today** or **Yesterday** or enter the date directly. Enter the 24-hour time (for example, `1430` or `14:30`) and confirm it to reveal the analysis options. In the development server, choose Ring or ABM, or open **Other analysis tools** for distance ranks. Distance ranks are relative to cells in the development grid. Export the distance run settings as JSON to reproduce it. If a map request reports an error, the warning stays visible until you select Retry.

From the repository root, use the Node.js version pinned in [.nvmrc](.nvmrc) (22.21.1).

```bash
nvm install
nvm use
cd frontend
npm ci
npm run dev
```

Open the Local URL printed by Vite in a WebGL-capable browser with internet access. From `frontend/`, run `npm run lint`, `npm test`, and `npm run build`. GitHub Actions runs the same frontend checks on pull requests. The `Backend checks` workflow also runs the Python 3.13 unit tests in `backend/tests`. See the [backend README](backend/README.md) for the local setup and test command. Docker is optional for local development.

To run **Ring model** from the Last Known Point panel, first set up Python 3.13 from the repository root:

```bash
python3.13 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
```

Then start Vite locally, confirm the LKP and last-seen time, and select **Ring model**. The backend uses the temperate mountain hiker profile and returns one distance-based probability map. It does not use terrain, travel restrictions, or elapsed time. The map softens the displayed color transitions between cells. The underlying probabilities are conditional on the development grid, and the result panel reports how much of the model's mass falls inside it. This button requires the Vite development server. A static build still supports distance ranks and imported timelines.

Use **Measure distance** in the left rail to place points and sum the horizontal distances between them. Switch tools or hide the measurement line without losing the current measurement. Each measurement lists its segments and total. **Start a new measurement** keeps previous lines available in the selector. Distances are horizontal, and measurements are retained until the page is reloaded.

The bottom of the map shows latitude and longitude while the pointer is over the map.

In the local development server, select **ABM · Behavior simulation** in Last Known Point. Choose Random Walking or moving to higher ground, one or two hours, and whether to apply the map's reviewed travel restrictions. The simulator runs 512 paths with a fixed seed and reports a snapshot every 30 minutes. Results first show the selected calculation endpoint. Move the slider or use **Play time changes** to review the snapshots. The average straight-line distance from the last known point uses the displayed cell probabilities. The soft map glow is for display only. Higher-ground behavior and optional slope limits require an aligned numerical DEM. Results record the access revision, when applied, and warn when it changes. If the starting cell is isolated under the selected conditions, Results shows that the simulation stayed at its starting point.

The time slider under Results displays precomputed model snapshots on a shared color scale. Load a timeline JSON with its last known point (LKP) and timestamp, or open the labeled synthetic example. See the [timeline format](frontend/README.md#시간별-결과-형식).

In the local development server, **Field reports** lets a user mark a searched circle, enter the original report and search time, then explicitly approve it with a reviewer name and reason. Approved records stay in this browser, grouped by analysis grid and the same last-known location and time. Toggle **Field report areas** in **Approved records** and click an approved area to inspect its record. The update uses a 50% development detection assumption and applies to the selected ABM snapshot only. Rerunning the identical analysis restores its saved adjustment without applying the report again.

Under **Field reports → Incident timeline**, add tip, CCTV, GPS signal and search markers from the map. Select a marker to open its details and delete it if needed. The last known point has its own remove action in the point details. The timeline lists the last known point, markers, field observations and approvals by time. Selecting an item opens its location or record. A search marker can prefill a report with its point, observation time and note. The existing approval form asks for the search radius, reviewer and reason before updating the selected ABM snapshot. Markers can be saved anywhere on the map in this browser. Before the last known point and time are set, markers are saved as unassigned and can be attached to the case from the timeline. Search reports use points inside the analysis area.

GPS markers accept a signal source and optional accuracy in meters. A reviewer records a decision and reason before an in-grid signal can be adopted as the last known point and time. The incident timeline records the adoption and retains earlier case records. The analysis panel opens with the adopted values for an explicit ABM rerun.

To compare ABM runs, save an original result as **Baseline A** from Results, run ABM again for the same last known location, time, seed, and path count, then select **Compare baseline and current**. Both maps pan and zoom together and share the same color scale and overlapping time steps. The baseline is kept until the page is reloaded.

Use **Candidate areas** to click two corners inside the analysis grid. FindWise snaps the rectangle to whole cells. The comparison table shows area and summed model probability from the current Ring result or selected ABM frame. Sort by probability, area, or creation order and select a row to locate the candidate on the map. Ring percentages are conditional on the grid. After a case or applied terrain change makes the result stale, rerun the analysis to see probability totals. Candidate areas are kept until the page is reloaded. For a frame with approved search-completed reports, choose a report and a candidate to see the candidate’s probability immediately before and after that approval and the change in percentage points. Open the change to see the report and approval details. **Approved records** links back to that report’s frame.

Field reports also accepts human-approved **No access** records. They mark the reported area on the map. The review list pairs these with **Search completed** reports from the same case when the circles overlap and the observation times are no more than 60 minutes apart. This is a review cue; movement settings and probability calculations remain separate.

## Data and evaluation

The optional backend terrain CLI aligns a numerical DEM to the grid exported by the map and derives slope and a validity mask. See the [terrain CLI](backend/README.md), [Yosemite data catalog](data/catalog/yosemite.md), and [evaluation draft](docs/evaluation.md).

The backend also reproduces the agent-based lost person behavior model of Hashimoto et al. (2022, 2026) in `backend/app/abm_reproduction/`. Random walking, staying put, view enhancing, backtracking, route traveling, and direction traveling are implemented as backend strategies. The web preview currently exposes only random walking and view enhancing. Decision-point behavior switching and contouring are not implemented yet. Contouring waits for the paper's supplementary definition because the main text gives no threshold. See the [behavior strategy package](backend/app/abm_reproduction/strategies/README.md).

Yosemite start–find location pairs may be used after validating usage terms and usable case matches. Without actual radio records, report-processing and map-update experiments remain separate synthetic scenarios. Results from overseas data must not be presented as validated domestic performance.

Region and grid settings live in `frontend/src/map/regions.ts`. The Bukhansan team demo uses a 10 m grid and prepared trails, waterways, and elevation/slope display images. Place the supplied `trails.geojson`, `waterways.geojson`, `elevation.png`, and `slope.png` in `data/raw/bukhansan-demo/`. ABM modes that use numerical elevation or slope require a separate Bukhansan DEM aligned to this grid at `data/processed/bukhansan-terrain.npz`. Computational cell size and source elevation resolution are separate. Contours are a display layer. Terrain analysis uses numerical elevation data. Keep evaluation targets, including find locations, out of prediction inputs and search extent selection.

Keep raw data, processed results, caches, evaluation data, and secrets out of Git. Keep public synthetic examples in `data/samples/` and record provenance and usage conditions in `data/catalog/`. Code licensing will be agreed by the team.

## Documentation

- [Frontend: running, data sources, and grid conventions](frontend/README.md)
- [Setup](docs/setup.md)
- [Contributing](CONTRIBUTING.md)
- [Shared development rules](AGENTS.md)

Terrain features can now be imported as GeoJSON, reviewed on the map, and exported with access settings for the shared model grid. See the [terrain workflow](backend/README.md#지형과-이동-조건).

Water multipolygons now retain islands and split boundaries. Models can use the shared eight-neighbor movement check with an explicit policy for unknown cells.


Default terrain layers load automatically from the prepared local OSM snapshot. Toggle trails, roads, rivers and water independently. Click a visible feature to block or allow passage, add a reason and apply. Changes and undo history are saved in this browser. Display toggles do not change model inputs. LKP and last-seen time are saved separately. Map display reset preserves these inputs and applied edits.

Prepare `data/raw/yosemite-terrain-v2.geojson` once using the [terrain workflow](backend/README.md#지형과-이동-조건). The dev server serves this file and builds include it as a separate asset when present. Source datasets stay excluded from Git. If it is unavailable, use Retry or advanced data import. A clean checkout needs this preparation. Browser storage is scoped to the site origin and device.

Timeline JSON can include `terrain_revision`. Results missing this value are shown with unverified terrain settings. Changed case inputs or a mismatched terrain revision produce a visible result warning. The distance baseline continues to rank by distance, and the synthetic timeline is available for interface checks.

The left navigation now separates Last Known Point, Results, Access Settings, and Edit History, with data imports in Data & Settings. Click or keyboard-activate the map marker to inspect last-seen time, elapsed time, result status, and nearby mapped trails and roads. Distances are straight-line measurements to loaded features, not travel times.
