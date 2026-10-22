"use client";

import { useEffect, useMemo, useRef } from "react";
import { Ban, ImagePlus, Upload } from "lucide-react";
import {
  buildTextureTile,
  TEXTURE_LABELS,
} from "@/lib/texturizer/textures";
import { TEXTURE_IDS } from "@/lib/texturizer/types";
import type {
  TextureId,
  TextureSelection,
  TextureTile,
} from "@/lib/texturizer/types";
import { cn } from "@/lib/utils";

function TileCanvas({ tile }: { tile: TextureTile }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = tile.size;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = context.createImageData(size, size);
    for (let index = 0; index < tile.data.length; index += 1) {
      const value = Math.round(24 + tile.data[index] * 214);
      const offset = index * 4;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = Math.min(255, Math.round(value * 0.94));
      image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, [tile]);
  return <canvas ref={canvasRef} className="size-full" aria-hidden />;
}

function ProceduralThumb({ id }: { id: TextureId }) {
  const tile = useMemo(() => buildTextureTile(id, 72), [id]);
  return <TileCanvas tile={tile} />;
}

function TextureTileButton({
  id,
  selected,
  onSelect,
}: {
  id: TextureId;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={TEXTURE_LABELS[id]}
      title={TEXTURE_LABELS[id]}
      onClick={onSelect}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-md border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary ring-2 ring-primary/40"
          : "border-border hover:border-foreground/30"
      )}
    >
      <ProceduralThumb id={id} />
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-1.5 pb-1 pt-4 text-[9px] font-medium leading-none text-white">
        {TEXTURE_LABELS[id]}
      </span>
    </button>
  );
}

export function TextureGallery({
  selected,
  customTile,
  customName,
  onSelect,
  onCustomClick,
  onClearCustom,
}: {
  selected: TextureSelection | null;
  customTile: TextureTile | null;
  customName: string | null;
  onSelect: (id: TextureSelection | null) => void;
  onCustomClick: () => void;
  onClearCustom: () => void;
}) {
  const customSelected = selected === "custom";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        <button
          type="button"
          aria-pressed={selected === null}
          aria-label="Sin textura"
          title="Sin textura"
          onClick={() => onSelect(null)}
          className={cn(
            "group relative aspect-square overflow-hidden rounded-md border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected === null
              ? "border-primary ring-2 ring-primary/40"
              : "border-border hover:border-foreground/30"
          )}
        >
          <span className="flex size-full items-center justify-center bg-muted/35 text-muted-foreground">
            <Ban className="size-6" aria-hidden />
          </span>
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-1.5 pb-1 pt-4 text-[9px] font-medium leading-none text-white">
            Sin textura
          </span>
        </button>
        {TEXTURE_IDS.map((id) => (
          <TextureTileButton
            key={id}
            id={id}
            selected={selected === id}
            onSelect={() => onSelect(id)}
          />
        ))}
        {customTile ? (
          <button
            type="button"
            aria-pressed={customSelected}
            aria-label={customName ?? TEXTURE_LABELS.custom}
            title={customName ?? TEXTURE_LABELS.custom}
            onClick={() => onSelect("custom")}
            className={cn(
              "group relative aspect-square overflow-hidden rounded-md border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              customSelected
                ? "border-primary ring-2 ring-primary/40"
                : "border-border hover:border-foreground/30"
            )}
          >
            <TileCanvas tile={customTile} />
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 via-black/45 to-transparent px-1.5 pb-1 pt-4 text-[9px] font-medium leading-none text-white">
              {customName ?? "Personalizada"}
            </span>
          </button>
        ) : (
          <button
            type="button"
            aria-label="Subir mapa personalizado"
            title="Subir mapa personalizado"
            onClick={onCustomClick}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Upload className="size-4" aria-hidden />
            <span className="text-[9px] font-medium leading-none">Personalizado</span>
          </button>
        )}
      </div>
      {customTile ? (
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <ImagePlus className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{customName ?? "Mapa personalizado"}</span>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onCustomClick}
              className="rounded px-1.5 py-0.5 text-[11px] text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cambiar
            </button>
            <button
              type="button"
              onClick={onClearCustom}
              className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Quitar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
