import JSZip from "jszip";
import { db } from "../data/db";
import { saveAs } from "file-saver";

const formatDiagram = (diagram) => {
  const formattedDiagram = { ...diagram };
  formattedDiagram.relationships = diagram.references;
  formattedDiagram.subjectAreas = diagram.areas;

  delete formattedDiagram.references;
  delete formattedDiagram.areas;

  return formattedDiagram;
};

/**
 * Downloads a zip of every locally saved diagram and custom template.
 *
 * Resolves only once the file has actually been handed to the browser. That
 * matters because the cloud migration awaits this and then calls
 * `db.diagrams.clear()` — it used to resolve as soon as zip generation was
 * *started*, so the backup guarding an irreversible delete guaranteed nothing.
 */
export async function exportSavedData() {
  // Built per call: a module-level JSZip accumulates, so a second export would
  // ship the first export's files too.
  const zip = new JSZip();
  const diagramsFolder = zip.folder("diagrams");

  await db.diagrams.each((diagram) => {
    diagramsFolder.file(
      `${diagram.name}(${diagram.id}).json`,
      JSON.stringify(formatDiagram(diagram), null, 2),
    );
    return true;
  });

  const templatesFolder = zip.folder("templates");

  await db.templates.where({ custom: 1 }).each((template) => {
    templatesFolder.file(
      `${template.title}(${template.id}).json`,
      JSON.stringify(formatDiagram(template), null, 2),
    );
    return true;
  });

  const content = await zip.generateAsync({ type: "blob" });
  const date = new Date();
  saveAs(
    content,
    `${date.getFullYear()}_${date.getMonth()}_${date.getDay()}_export.zip`,
  );
}
