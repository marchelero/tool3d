import type { Metadata } from "next";
import { ImageTool } from "@/components/tools/image/image-tool";

export const metadata: Metadata = {
  title: "Herramienta de imagen",
  description:
    "Quita el fondo, retoca, exporta PNG, vectoriza a SVG y separa por colores. Todo en tu navegador.",
};

export default function ImageToolPage() {
  return <ImageTool />;
}
