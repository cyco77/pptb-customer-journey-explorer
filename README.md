# Customer Journey Explorer

![Customer Journey Explorer](https://raw.githubusercontent.com/cyco77/pptb-customer-journey-migrator/HEAD/icon/customer-journey-migrator_small.png)

A Power Platform Toolbox (PPTB) tool for exploring Customer Insights - Journeys records and their Dataverse dependencies. The tool provides a read-only dependency view for understanding how journeys, actions, conditions, lookups, and related records are connected.

## Screenshots

### Dark Theme

![Customer Journey Explorer - Dark Theme](https://raw.githubusercontent.com/cyco77/pptb-customer-journey-migrator/HEAD/screenshots/main_dark.png)

## Features

### Core Capabilities

- 🔎 **Journey Selection** - Load Customer Insights - Journeys records from the active Dataverse environment.
- 🌳 **Dependency Explorer** - Discover supported lookup and embedded JSON dependencies in an interactive tree.
- 🧩 **Journey Definition Analysis** - Inspect triggers, actions, branches, conditions, tasks, and email references.
- 🔗 **Related Record Discovery** - Follow Dataverse lookups and relationship metadata to related records.
- ⚠️ **Unresolved References** - Keep references that cannot be resolved visible as discovery warnings.
- 📄 **Record Details** - Inspect the fields and source data of discovered records.
- 🚀 **Open in Dataverse** - Open supported records directly in the environment's model-driven app.

## Discovery Scope

Customer Insights - Journeys schemas can vary between environments and product versions. The explorer therefore resolves tables and readable columns from Dataverse metadata and treats embedded JSON references as best-effort information rather than universally understood lookups.

- The initial Journey list is limited to 200 records per matching Journey table.
- Analytics, interaction, contact-record, tracking, telemetry, event, and log tables are excluded from the initial selector.
- Dependency discovery starts only after selecting a Journey and choosing **Discover dependencies**.
- Discovery is limited to 250 graph nodes and five dependency levels.
- The current MVP focuses on Dataverse lookups, related records found through relationship metadata, and typed GUID references in JSON fields.
- The tool is read-only and does not create, update, delete, publish, activate, or migrate records.

Environment comparison and migration are not supported yet.

## Requirements

- Read permissions for Customer Insights - Journeys tables and relevant related records.
- Permission to open Dataverse records in the environment's model-driven app.

## License

MIT - See [LICENSE](./LICENSE) for details.

## Author

Lars Hildebrandt
