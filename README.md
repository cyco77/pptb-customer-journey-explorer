# Customer Journey Explorer

Customer Journey Explorer is a read-only Power Platform ToolBox tool for exploring Customer Insights - Journeys records and their Dataverse dependencies.

## MVP features

- Uses the active (primary) PPTB Dataverse connection.
- Loads only Customer Journey records into the initial selector; dependencies are not queried while the selector is loading.
- Lets you select one Journey and explicitly start loading its supported lookup and embedded JSON dependencies.
- Shows discovered records and unresolved references in an interactive dependency tree.
- Displays record details and opens supported records in the environment's model-driven app.
- Writes structured diagnostics for failed Dataverse queries and metadata requests to the browser DevTools console; the UI can copy the collected diagnostic report as JSON.
- Does not create, update, delete, publish, activate, or migrate records.

The tool intentionally does not use a secondary connection or compare environments yet. Environment comparison and migration are planned as later steps.

## Discovery notes

Customer Insights - Journeys schemas can vary between environments and versions. The tool resolves tables and readable columns from Dataverse metadata and surfaces discovery warnings when a table or reference cannot be read. Embedded JSON references are best-effort and are not treated as universally understood Dataverse lookups.

The initial Journey list is limited to 200 records per matching Journey table. Analytics, interaction, contact-record, tracking, telemetry, event, and log tables are excluded from the selector. Dependency discovery is performed only after choosing a Journey and pressing **Discover dependencies**; it is limited to a maximum of 250 graph nodes and five dependency levels. The current MVP focuses on Dataverse lookups, related records found through relationship metadata, and typed GUID references in JSON fields; unresolved references remain visible as warnings.

## Requirements

- Power Platform ToolBox with an active Dataverse connection.
- Read permissions for Customer Insights - Journeys tables and their relevant related records.
- Access to open Dataverse records in the environment.

## License

MIT - See [LICENSE](./LICENSE).
