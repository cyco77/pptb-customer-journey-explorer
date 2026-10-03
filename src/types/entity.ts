import { View } from "./view";

export type Entity = {
  logicalname: string;
  displayname: string;
  entitysetname: string;
  views?: View[];
  selectedViewId?: string;
  recordCount?: number;
  isLoading?: boolean;
  progressMessage?: string;
};
