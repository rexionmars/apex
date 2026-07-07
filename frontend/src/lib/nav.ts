// Open MCT-style navigation model: domain objects in a tree, and
// "views" (ways to view/act on) the selected object.

export type ObjType = "root" | "import" | "dashboard" | "live" | "batch" | "carcass";

export interface DomainObject {
  type: ObjType;
  id: string; // unique key in the tree (e.g., "batch:3", "carcass:12", "import")
  name: string;
  // data references when applicable
  batchId?: number;
  carcassId?: number;
  imageCount?: number;
}

export type ViewKey = "overview" | "images" | "analysis" | "grading" | "import" | "dashboard" | "live";

export interface ViewDef {
  key: ViewKey;
  label: string;
}

// Which views each object type offers (they appear in the browse bar's view switcher).
export function viewsFor(obj: DomainObject | null): ViewDef[] {
  if (!obj) return [];
  switch (obj.type) {
    case "batch":
      return [
        { key: "overview", label: "Overview" },
        { key: "analysis", label: "Analysis" },
        { key: "grading", label: "Grading" },
      ];
    case "carcass":
      return [
        { key: "overview", label: "Overview" },
        { key: "images", label: "Images" },
        { key: "analysis", label: "Analysis" },
      ];
    case "import":
      return [{ key: "import", label: "Import" }];
    case "dashboard":
      return [{ key: "dashboard", label: "Dashboard" }];
    case "live":
      return [{ key: "live", label: "Live monitor" }];
    default:
      return [{ key: "overview", label: "Overview" }];
  }
}
