"use client";

import { Responsive, WidthProvider, type Layout } from "react-grid-layout";

import type { TableroWidget } from "@/lib/domains/tableros";
import { WidgetCard } from "./tablero-editor";

const ResponsiveGridWidth = WidthProvider(Responsive);

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 };

export function DragDropGrid({
  layout,
  onLayoutChange,
  widgets,
  onEdit,
  onDelete,
}: {
  layout: Layout[];
  onLayoutChange: (l: Layout[]) => void;
  widgets: TableroWidget[];
  onEdit: (w: TableroWidget) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <ResponsiveGridWidth
      className="layout"
      layouts={{ lg: layout, md: layout, sm: layout, xs: layout, xxs: layout }}
      breakpoints={BREAKPOINTS}
      cols={COLS}
      rowHeight={60}
      onLayoutChange={(_, all) => {
        // Tomamos el layout de 'lg' como la fuente de verdad
        onLayoutChange(all.lg ?? []);
      }}
      draggableHandle=".widget-drag-handle"
      compactType="vertical"
      preventCollision={false}
    >
      {widgets.map((w) => (
        <div key={w.id}>
          <WidgetCard widget={w} onEdit={onEdit} onDelete={onDelete} />
        </div>
      ))}
    </ResponsiveGridWidth>
  );
}
