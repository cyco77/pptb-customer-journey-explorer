# Customer Journey Explorer

![Customer Journey Explorer](https://raw.githubusercontent.com/cyco77/pptb-customer-journey-explorer/HEAD/icon/customer-journey-explorer_small.png)

A Power Platform Toolbox (PPTB) tool for displaying Customer Insights - Journeys records and their Dataverse dependencies. Explore journeys, actions, conditions, lookups, and related records in a simple tree view.

## Screenshots

![Customer Journey Explorer - Dark Theme](https://raw.githubusercontent.com/cyco77/pptb-customer-journey-explorer/HEAD/screenshots/main_dark.png)

## Features

### Core Capabilities

- 🔎 **Journey Selection** - Load Customer Insights - Journeys records from the active Dataverse environment.
- 🌳 **Dependency Explorer** - Discover supported lookup and embedded JSON dependencies in an interactive tree.
- 🧩 **Journey Definition Analysis** - Inspect triggers, actions, branches, conditions, tasks, and email references.
- 🔗 **Related Record Discovery** - Follow Dataverse lookups and relationship metadata to related records.
- ⚠️ **Unresolved References** - Keep references that cannot be resolved visible as discovery warnings.
- 📄 **Record Details** - Inspect the fields and source data of discovered records.
- 📝 **Markdown Export** - Export the Journey map, dependency tree, conditions, and record details as a Markdown report.
- 🚀 **Open in Dataverse** - Open supported records directly in the environment's model-driven app.

## Discovery Scope

Customer Insights - Journeys schemas can vary between environments and product versions. The explorer therefore resolves tables and readable columns from Dataverse metadata and treats embedded JSON references as best-effort information rather than universally understood lookups.

- Journey tables are loaded through Dataverse pagination; dependency display is bounded to 250 Dataverse artifacts and five dependency levels.
- Analytics, interaction, contact-record, tracking, telemetry, event, and log tables are excluded from the initial selector.
- Dependency discovery starts when a Journey is selected.
- The dependency view is limited to 250 artifacts and five dependency levels.

## Requirements

- Read permissions for Customer Insights - Journeys tables and relevant related records.
- Permission to open Dataverse records in the environment's model-driven app.

## License

MIT - See [LICENSE](./LICENSE) for details.

## Author

Lars Hildebrandt
