// Add entity logical names that should be ignored during loading/counting.
// Example: "audit", "workflow", "plugintype"
export const ENTITY_LOGICAL_NAME_BLACKLIST: string[] = [
  "exchangesyncidmapping",
  "fabricaiskill",
  "roleeditorlayout",
  "userquery",
  "userqueryvisualization",
  "msdyn_agentcopilotsetting",
  "msdyn_copilotsummarizationsetting",
  "msdyn_servicecopilotplugin",
  "msdyn_servicecopilotpluginaction",
  "msdyn_servicecopilotpluginrole",
];

const normalizedBlacklist = new Set(
  ENTITY_LOGICAL_NAME_BLACKLIST.map((name) => name.toLowerCase().trim()),
);

export const isEntityBlacklisted = (entityLogicalName: string): boolean => {
  return normalizedBlacklist.has(entityLogicalName.toLowerCase().trim());
};
