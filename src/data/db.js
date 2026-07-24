import Dexie from "dexie";
import { v4 as uuidv4 } from "uuid";
import { templateSeeds } from "./seeds";

export const db = new Dexie("drawDB");

db.version(67)
  .stores({
    diagrams: "++id, lastModified, loadedFromGistId, diagramId",
    templates: "++id, custom, templateId",
  })
  .upgrade(async (tx) => {
    await tx.diagrams.toCollection().modify((diagram) => {
      if (!diagram.diagramId) {
        diagram.diagramId = uuidv4();
      }
    });
    await tx.templates.toCollection().modify((template) => {
      if (!template.templateId) {
        template.templateId = uuidv4();
      }
    });
  });

// Offline cache + outbox for cloud-stored diagrams. Deliberately separate from
// `diagrams`: Workspace's fetchDiagram prefers local rows, so mirrors living in
// `diagrams` would shadow newer cloud versions and reroute saves to local.
db.version(68).stores({
  cloudMirror: "diagramId",
});

db.on("populate", (transaction) => {
  transaction.templates.bulkAdd(templateSeeds).catch((e) => console.log(e));
});
