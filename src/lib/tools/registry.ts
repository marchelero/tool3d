import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Coffee,
  Image as ImageIcon,
  KeyRound,
  Ruler,
  Shapes,
  Type,
} from "lucide-react";

export type ToolCategory = "imagen" | "3d" | "utilidades";

export type ToolStatus = "available" | "soon";

export interface ToolDefinition {
  slug: string;
  name: string;
  description: string;
  category: ToolCategory;
  status: ToolStatus;
  icon: LucideIcon;
  tags: string[];
  features?: string[];
}

export const TOOL_CATEGORIES: { id: ToolCategory; label: string }[] = [
  { id: "imagen", label: "Imagen" },
  { id: "3d", label: "3D" },
  { id: "utilidades", label: "Utilidades" },
];

export const TOOLS: ToolDefinition[] = [
  {
    slug: "image",
    name: "Imagen",
    description:
      "Prepara imágenes para imprimir: quita el fondo, corrígelo a mano, exporta PNG o vectoriza a SVG y separa por colores.",
    category: "imagen",
    status: "available",
    icon: ImageIcon,
    tags: ["fondo", "png", "svg", "vectorizar", "colores"],
    features: [
      "Quitar fondo con IA en el navegador",
      "Retoque manual (borrar / restaurar)",
      "Exportar PNG transparente",
      "Vectorizar a SVG",
      "Dividir en SVG por color",
    ],
  },
  {
    slug: "llavero",
    name: "Llavero con imagen",
    description:
      "Convierte tus diseños vectorizados en llaveros listos para imprimir en 3D.",
    category: "3d",
    status: "available",
    icon: KeyRound,
    tags: ["llavero", "anilla", "relieve", "svg"],
  },
  {
    slug: "keychain",
    name: "Llaveros con nombres",
    description:
      "Genera llaveros personalizados con nombres y letras, listos para imprimir en 3D.",
    category: "3d",
    status: "soon",
    icon: Type,
    tags: ["llavero", "nombre", "letras", "texto"],
  },
  {
    slug: "posavasos",
    name: "Posavasos",
    description:
      "Convierte tus diseños vectorizados en posavasos con relieve listos para imprimir en 3D.",
    category: "3d",
    status: "available",
    icon: Coffee,
    tags: ["posavasos", "relieve", "circular", "svg"],
  },
  {
    slug: "generate-3d",
    name: "Generar 3D",
    description:
      "Convierte siluetas y contornos en modelos 3D y exporta en STL / 3MF.",
    category: "3d",
    status: "soon",
    icon: Shapes,
    tags: ["stl", "3mf", "extrusion", "modelo"],
  },
  {
    slug: "calibration",
    name: "Calibración",
    description:
      "Herramientas de calibración y presets de impresión para afinar tu impresora.",
    category: "utilidades",
    status: "soon",
    icon: Ruler,
    tags: ["preset", "calibración", "tolerancias"],
  },
  {
    slug: "boxes",
    name: "Cajas y contenedores",
    description:
      "Genera cajas paramétricas y organizadores para tus proyectos 3D.",
    category: "utilidades",
    status: "soon",
    icon: Boxes,
    tags: ["caja", "organizador", "paramétrico"],
  },
];

export function getTool(slug: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}

export function getAvailableTools(): ToolDefinition[] {
  return TOOLS.filter((tool) => tool.status === "available");
}
