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

The web app displays a Yosemite base map and satellite imagery with independent contours and hillshade. The default projected grid has 6 m cells in a 6 × 6 km development area. You can show the boundary, inspect visible grid lines at zoom 16 or higher, and download the grid definition as JSON from Region Info. In Last Known Point, select and confirm the last known point (LKP), enter the last-seen time, and run the distance baseline. Export the run settings as JSON to reproduce it. The overlay shows relative cell ranks within the development grid. Probability models, field report processing, and the backend API are planned. If a map request reports an error, the warning stays visible until you select Retry.

From the repository root, use the Node.js version pinned in [.nvmrc](.nvmrc) (22.21.1).

```bash
nvm install
nvm use
cd frontend
npm ci
npm run dev
```

Open the Local URL printed by Vite in a WebGL-capable browser with internet access. From `frontend/`, run `npm run lint`, `npm test`, and `npm run build`. GitHub Actions runs the same checks on pull requests. Docker is optional for local development.

The bottom of the map shows latitude and longitude while the pointer is over the map.

The time slider under Results displays precomputed model snapshots on a shared color scale. Load a timeline JSON with its last known point (LKP) and timestamp, or open the labeled synthetic example. See the [timeline format](frontend/README.md#시간별-결과-형식).

## Data and evaluation

The optional backend terrain CLI aligns a numerical DEM to the grid exported by the map and derives slope and a validity mask. See the [terrain CLI](backend/README.md), [Yosemite data catalog](data/catalog/yosemite.md), and [evaluation draft](docs/evaluation.md).

Yosemite start–find location pairs may be used after validating usage terms and usable case matches. Without actual radio records, report-processing and map-update experiments remain separate synthetic scenarios. Results from overseas data must not be presented as validated domestic performance.

Region and grid settings live in `frontend/src/map/config.ts`. Computational cell size and source elevation resolution are separate. Contours are a display layer. Terrain analysis uses numerical elevation data. Keep evaluation targets, including find locations, out of prediction inputs and search extent selection.

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
