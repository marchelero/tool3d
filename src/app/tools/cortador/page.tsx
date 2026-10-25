import type { Metadata } from "next";
import { CortadorTool } from "@/components/tools/cortador/cortador-tool";

export const metadata: Metadata = {
  title: "Cortador de piezas 3D",
  description:
    "Partí un STL o 3MF en piezas imprimibles con cortes rectos, curvos o por forma, encastres y reparación de malla. Todo en tu navegador.",
};

export default function CortadorPage() {
  return <CortadorTool />;
}
