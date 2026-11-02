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

## Workflow

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
backend/     Terrain processing, analysis, reports, and APIs
data/       Source/processed data, samples, and provenance
docs/       Planning materials, architecture, and setup
.github/     Issue and pull request templates
```

Keep the top-level structure small. Split code within frontend and backend when actual implementation needs it. See [architecture](docs/architecture.md).

## Status and getting started

Only the repository structure and documentation are prepared. There is no executable application, connected map dataset, or trained/validated model yet. The first implementation will establish a Yosemite map with independent layers and a computational grid for future heatmaps.

See the [setup guide](docs/setup.md). Installation and execution commands will be documented with the first runnable implementation. Docker is not required at this stage.

## Data and evaluation

Yosemite start–find location pairs may be used after validating usage terms and usable case matches. Without actual radio records, report-processing and map-update experiments remain separate synthetic scenarios. Results from overseas data must not be presented as validated domestic performance.

A 6 m grid is an initial experiment candidate, not a hard-coded requirement. Source elevation resolution and computational cell size are separate. Contours are a visual layer; numerical elevation data is an input to terrain calculations.

Do not commit source datasets, large outputs, or secrets. Record provenance and usage conditions. Code licensing will be agreed by the team.

## Documentation

- [Project overview (Korean)](docs/planning/overview.md)
- [Project plan (Korean)](docs/planning/project-plan.md)
- [Development specification (Korean)](docs/planning/specification.md)
- [Architecture](docs/architecture.md)
- [Map foundation criteria](docs/map-foundation.md)
- [Contributing](CONTRIBUTING.md)

Planning materials are reference snapshots. Later decisions, including the simpler structure, Yosemite-first implementation, and optional Docker use, are described in this README and the architecture guide.
