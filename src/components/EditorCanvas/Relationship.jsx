import { useMemo, useRef, useState, useEffect } from "react";
import { Cardinality, ObjectType, Tab } from "../../data/constants";
import { calcPath, calcCompositePath } from "../../utils/calcPath";
import { getRequiredTableWidth } from "../../utils/tableWidth";
import { roughPath, seedFrom } from "../../utils/roughShapes";
import {
  useDiagram,
  useSettings,
  useLayout,
  useSelect,
  useFontsReady,
} from "../../hooks";
import { useTranslation } from "react-i18next";
import {
  getVisibleFieldIndex,
  getVisibleFields,
  getRelationshipFields,
} from "../../utils/utils";

const labelFontSize = 16;

export default function Relationship({ data }) {
  const { settings } = useSettings();
  const { tables, relationships, database } = useDiagram();
  const { layout } = useLayout();
  const { selectedElement, setSelectedElement } = useSelect();
  const { t } = useTranslation();
  const fontsTick = useFontsReady();

  const pathValues = useMemo(() => {
    const startTable = tables.find((t) => t.id === data.startTableId);
    const endTable = tables.find((t) => t.id === data.endTableId);

    if (!startTable || !endTable || startTable.hidden || endTable.hidden)
      return null;

    const startFields = getVisibleFields(startTable, relationships);
    const endFields = getVisibleFields(endTable, relationships);

    const pairs = getRelationshipFields(data);

    return {
      startFieldIndex: getVisibleFieldIndex(
        startTable,
        data.startFieldId,
        relationships,
      ),
      endFieldIndex: getVisibleFieldIndex(
        endTable,
        data.endFieldId,
        relationships,
      ),
      startFieldIndices: pairs.map((p) =>
        getVisibleFieldIndex(startTable, p.startFieldId, relationships),
      ),
      endFieldIndices: pairs.map((p) =>
        getVisibleFieldIndex(endTable, p.endFieldId, relationships),
      ),
      startTable: {
        x: startTable.x,
        y: startTable.y,
        comment: startTable.comment,
        fields: startFields,
      },
      endTable: {
        x: endTable.x,
        y: endTable.y,
        comment: endTable.comment,
        fields: endFields,
      },
    };
  }, [tables, relationships, data]);

  const isComposite = (pathValues?.startFieldIndices?.length ?? 0) > 1;

  // Endpoints can be different widths (cards size to their content), so the
  // geometry needs each side's own width.
  const endpointWidths = useMemo(() => {
    if (!pathValues) return {};
    const startTable = tables.find((t) => t.id === data.startTableId);
    const endTable = tables.find((t) => t.id === data.endTableId);
    return {
      startWidth: getRequiredTableWidth(startTable, database, settings),
      endWidth: getRequiredTableWidth(endTable, database, settings),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pathValues,
    tables,
    data.startTableId,
    data.endTableId,
    database,
    settings,
    fontsTick,
  ]);

  const composite = useMemo(() => {
    if (!pathValues || !isComposite) return null;
    return calcCompositePath(
      {
        startTable: pathValues.startTable,
        endTable: pathValues.endTable,
        startFieldIndices: pathValues.startFieldIndices,
        endFieldIndices: pathValues.endFieldIndices,
      },
      settings.tableWidth,
      1,
      settings.showComments,
      endpointWidths,
    );
  }, [
    pathValues,
    isComposite,
    settings.tableWidth,
    settings.showComments,
    endpointWidths,
  ]);

  const pathRef = useRef();
  const labelRef = useRef();

  let cardinalityStart = "1";
  let cardinalityEnd = "1";

  switch (data.cardinality) {
    // the translated values are to ensure backwards compatibility
    case t(Cardinality.MANY_TO_ONE):
    case Cardinality.MANY_TO_ONE:
      cardinalityStart = data.manyLabel || "n";
      cardinalityEnd = "1";
      break;
    case t(Cardinality.ONE_TO_MANY):
    case Cardinality.ONE_TO_MANY:
      cardinalityStart = "1";
      cardinalityEnd = data.manyLabel || "n";
      break;
    case t(Cardinality.ONE_TO_ONE):
    case Cardinality.ONE_TO_ONE:
      cardinalityStart = "1";
      cardinalityEnd = "1";
      break;
    default:
      break;
  }

  let cardinalityStartX = 0;
  let cardinalityEndX = 0;
  let cardinalityStartY = 0;
  let cardinalityEndY = 0;
  let labelX = 0;
  let labelY = 0;

  let labelWidth = labelRef.current?.getBBox().width ?? 0;
  let labelHeight = labelRef.current?.getBBox().height ?? 0;

  // Far enough along the curve to clear the card edge and its type labels.
  const cardinalityOffset = 40;

  if (composite) {
    labelX = composite.labelPoint.x - (labelWidth ?? 0) / 2;
    labelY = composite.labelPoint.y + (labelHeight ?? 0) / 2;
    cardinalityStartX = composite.startCardinality.x;
    cardinalityStartY = composite.startCardinality.y;
    cardinalityEndX = composite.endCardinality.x;
    cardinalityEndY = composite.endCardinality.y;
  } else if (pathRef.current) {
    const pathLength = pathRef.current.getTotalLength();

    const labelPoint = pathRef.current.getPointAtLength(pathLength / 2);
    labelX = labelPoint.x - (labelWidth ?? 0) / 2;
    labelY = labelPoint.y + (labelHeight ?? 0) / 2;
    // On short connectors the midpoint label collides with the cardinality
    // badges pinned near both ends; lift it clear instead of overlapping.
    if (pathLength < cardinalityOffset * 2 + (labelWidth ?? 0)) {
      labelY -= (labelHeight ?? 0) + 6;
    }

    const point1 = pathRef.current.getPointAtLength(cardinalityOffset);
    cardinalityStartX = point1.x;
    cardinalityStartY = point1.y;
    const point2 = pathRef.current.getPointAtLength(
      pathLength - cardinalityOffset,
    );
    cardinalityEndX = point2.x;
    cardinalityEndY = point2.y;
  }

  const edit = () => {
    if (!layout.sidebar) {
      setSelectedElement((prev) => ({
        ...prev,
        element: ObjectType.RELATIONSHIP,
        id: data.id,
        open: true,
      }));
    } else {
      setSelectedElement((prev) => ({
        ...prev,
        currentTab: Tab.RELATIONSHIPS,
        element: ObjectType.RELATIONSHIP,
        id: data.id,
        open: true,
      }));
      if (selectedElement.currentTab !== Tab.RELATIONSHIPS) return;
      document
        .getElementById(`scroll_ref_${data.id}`)
        .scrollIntoView({ behavior: "smooth" });
    }
  };

  if (!pathValues) return null;

  const pathD = composite
    ? composite.path
    : calcPath(
        pathValues,
        settings.tableWidth,
        1,
        settings.showComments,
        endpointWidths,
      );
  // Hand-drawn strokes, seeded per relationship so they don't jitter.
  const sketchStrokes = settings.sketchMode
    ? roughPath(pathD, seedFrom(data.id))
    : null;
  // Tint the connector with the child table's colour so a dense diagram reads
  // as groups of related cards rather than a grey web.
  const lineColor =
    tables.find((t) => t.id === data.startTableId)?.color || "#8b8b8b";

  return (
    <>
      <g className="select-none group" onDoubleClick={edit}>
        {/* invisible wider path for better hover ux */}
        <path
          d={pathD}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          cursor="pointer"
        />
        {sketchStrokes ? (
          <>
            {/* geometry reference for label/cardinality placement */}
            <path ref={pathRef} d={pathD} fill="none" stroke="none" />
            {sketchStrokes.map((d, i) => (
              <path
                key={i}
                d={d}
                className="relationship-path"
                style={{ stroke: lineColor }}
                fill="none"
                cursor="pointer"
              />
            ))}
          </>
        ) : (
          <path
            ref={pathRef}
            d={pathD}
            className="relationship-path"
            style={{ stroke: lineColor }}
            fill="none"
            cursor="pointer"
          />
        )}
        {settings.showRelationshipLabels && (
          <text
            x={labelX}
            y={labelY}
            fill={settings.mode === "dark" ? "lightgrey" : "#333"}
            fontSize={labelFontSize}
            fontWeight={500}
            ref={labelRef}
            className="relationship-label"
          >
            {data.name}
          </text>
        )}
        {(composite || pathRef.current) && settings.showCardinality && (
          <>
            <CardinalityLabel
              x={cardinalityStartX}
              y={cardinalityStartY}
              text={cardinalityStart}
            />
            <CardinalityLabel
              x={cardinalityEndX}
              y={cardinalityEndY}
              text={cardinalityEnd}
            />
          </>
        )}
      </g>
    </>
  );
}

function CardinalityLabel({ x, y, text, r = 12, padding = 14 }) {
  const [textWidth, setTextWidth] = useState(0);
  const textRef = useRef(null);

  useEffect(() => {
    if (textRef.current) {
      const bbox = textRef.current.getBBox();
      setTextWidth(bbox.width);
    }
  }, [text]);

  return (
    <g>
      <rect
        x={x - textWidth / 2 - padding / 2}
        y={y - r}
        rx={r}
        ry={r}
        width={textWidth + padding}
        height={r * 2}
        fill="grey"
        className="group-hover:fill-sky-600"
      />
      <text
        ref={textRef}
        x={x}
        y={y}
        fill="white"
        strokeWidth="0.5"
        textAnchor="middle"
        alignmentBaseline="middle"
      >
        {text}
      </text>
    </g>
  );
}
