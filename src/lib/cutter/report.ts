import type { CutOp, CutterPartView, JointOptions } from "./types";

export interface AssemblyReportInput {
  fileName: string;
  parts: CutterPartView[];
  ops: CutOp[];
  totalVolume: number;
  generatedAt?: Date;
}

function format(value: number, digits = 1): string {
  return value.toLocaleString("es-AR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function opLabel(op: CutOp): string {
  if (op.kind === "plane") return `Plano ${op.axis.toUpperCase()}`;
  if (op.kind === "curve") return `Onda en ${op.axis.toUpperCase()}`;
  if (op.kind === "shape") return `Forma ${op.shape}`;
  if (op.kind === "components") return "Objetos";
  if (op.kind === "surface") {
    if (op.mode !== "piece") {
      return `Cáscara superficial (${format(op.depth, 1)} mm)`;
    }
    const cap =
      op.capMode === "planar" ? "tapa recta" : "contorno 3D";
    return `Pieza completa por contorno (${cap})`;
  }
  return op.label ?? "Zona separada";
}

function jointLabel(variant: JointOptions["variant"]): string {
  if (variant === "dowel") return "espiga";
  if (variant === "keyed") return "llave anti-rotación";
  if (variant === "dovetail") return "cola de milano";
  if (variant === "magnet") return "alojamientos para imanes";
  return "";
}

export function buildAssemblyReport({
  fileName,
  parts,
  ops,
  totalVolume,
  generatedAt = new Date(),
}: AssemblyReportInput): string {
  const lines: string[] = [
    `# Informe de ensamblaje — ${fileName}`,
    "",
    `Generado: ${generatedAt.toLocaleString("es-AR")}`,
    "",
    "## Resumen",
    "",
    `- Piezas: ${parts.length}`,
    `- Operaciones de corte: ${ops.filter((op) => op.enabled).length}`,
    `- Volumen total: ${format(totalVolume / 1000, 2)} cm³`,
    "",
    "## Piezas",
    "",
    "| Pieza | Volumen (cm³) | Triángulos | Watertight | Color |",
    "| --- | ---: | ---: | :---: | --- |",
  ];

  for (const part of parts) {
    lines.push(
      `| ${part.name} | ${format(part.volume / 1000, 2)} | ${
        part.diagnostics.triangles
      } | ${part.diagnostics.watertight ? "Sí" : "No"} | ${part.color} |`
    );
  }

  lines.push("", "## Cortes", "");
  if (ops.length === 0) {
    lines.push("- Sin cortes: la pieza se exporta completa.");
  } else {
    ops.forEach((op, index) => {
      const joint =
        (op.kind === "plane" || op.kind === "surface") && op.joint
          ? op.joint.variant === "magnet"
            ? ` · ${jointLabel(op.joint.variant)} Ø${format(
                op.joint.diameter,
                1
              )} mm, profundidad ${format(op.joint.length, 1)} mm, holgura radial ${format(
                op.joint.clearance,
                2
              )} mm${
                op.joint.count && op.joint.count > 1
                  ? `, ×${op.joint.count}`
                  : ""
              }`
            : ` · encastre Ø${format(op.joint.diameter, 1)} mm, largo ${format(
                op.joint.length,
                1
              )} mm, holgura ${format(op.joint.clearance, 2)} mm${
                op.joint.count && op.joint.count > 1
                  ? `, ×${op.joint.count}`
                  : ""
              }${op.joint.variant ? `, ${jointLabel(op.joint.variant)}` : ""}`
          : "";
      lines.push(
        `${index + 1}. ${opLabel(op)}${op.enabled ? "" : " (desactivado)"}${joint}`
      );
    });
  }

  lines.push(
    "",
    "## Impresión",
    "",
    "- Exportá cada STL o el 3MF con la distribución en cama activada.",
    "- Verificá la holgura del encastre con un cupón antes de imprimir la pieza final.",
    "- Las piezas deben imprimirse en la orientación indicada por el visor.",
    ""
  );

  return lines.join("\n");
}
